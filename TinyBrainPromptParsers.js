const Utils = require('./Utils.js');
const {
    PLAYER_ACTION_MOVEMENT,
    PLAYER_ACTION_PROSE_SCOPE,
    PLAYER_ACTION_VEHICLE_DECISION
} = require('./PlayerActionTinyBrainResult.js');
const {
    normalizePlayerActionAccompanyingCharacterSelection
} = require('./PlayerActionCompanions.js');

function requireResponseText(response, label) {
    if (typeof response !== 'string' || !response.trim()) {
        throw new Error(`${label} requires a non-empty response.`);
    }
    return response.trim();
}

function parseStrictXml(response, label) {
    const raw = requireResponseText(response, label);
    const unfenced = raw
        .replace(/^```(?:xml)?\s*/i, '')
        .replace(/\s*```$/i, '')
        .trim();
    const extracted = Utils.extractFinalXmlBlockFromResponse(unfenced);
    const xml = extracted || unfenced;
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

function normalizePlainResponse(response, label) {
    return requireResponseText(response, label)
        .replace(/^```(?:text)?\s*/i, '')
        .replace(/\s*```$/i, '')
        .trim();
}

function normalizeCompactChoiceResponse(response, label) {
    let normalized = normalizePlainResponse(response, label)
        .replace(/^[*_`~]+|[*_`~]+$/g, '')
        .trim()
        .replace(/^answer\s*:\s*/i, '')
        .trim();
    normalized = normalized.replace(/[.!]+$/g, '').trim();
    normalized = normalized
        .replace(/^[*_`~]+|[*_`~]+$/g, '')
        .trim();
    return normalized;
}

function rejectPlayerActionResultMarkup(response, label, { rejectHidden = false } = {}) {
    const forbidden = rejectHidden
        ? /<\/?(?:turnResult|moveTurnResult|hidden)\b/i
        : /<\/?(?:turnResult|moveTurnResult)\b/i;
    if (forbidden.test(response)) {
        throw new Error(`${label} must not contain player-action result XML.`);
    }
}

function parsePlayerActionMovement(response, onVehicle = false) {
    const normalized = normalizeCompactChoiceResponse(response, 'player-action movement').toUpperCase();
    const values = {
        NONE: PLAYER_ACTION_MOVEMENT.NONE,
        DESTINATION: PLAYER_ACTION_MOVEMENT.DESTINATION,
        INSIDE_VEHICLE: PLAYER_ACTION_MOVEMENT.INSIDE_VEHICLE,
        DISEMBARK: PLAYER_ACTION_MOVEMENT.DISEMBARK
    };
    if (!Object.hasOwn(values, normalized)) {
        throw new Error('Player-action movement must be exactly one allowed movement keyword.');
    }
    const value = values[normalized];
    if (onVehicle === true) {
        if (value === PLAYER_ACTION_MOVEMENT.DESTINATION) {
            throw new Error('Player movement from a vehicle must use DISEMBARK instead of DESTINATION.');
        }
    } else if (![PLAYER_ACTION_MOVEMENT.NONE, PLAYER_ACTION_MOVEMENT.DESTINATION].includes(value)) {
        throw new Error(`Player movement ${normalized} requires a current vehicle.`);
    }
    return { value };
}

function parsePlayerActionVehicleDecision(
    response,
    movement,
    isUnderway = false
) {
    if (!Object.values(PLAYER_ACTION_MOVEMENT).includes(movement)) {
        throw new Error('Player-action vehicle decision requires a valid movement value.');
    }
    const normalized = normalizeCompactChoiceResponse(response, 'player-action vehicle decision').toUpperCase();
    const values = {
        UNCHANGED: PLAYER_ACTION_VEHICLE_DECISION.UNCHANGED,
        DEPART: PLAYER_ACTION_VEHICLE_DECISION.DEPART,
        STOP: PLAYER_ACTION_VEHICLE_DECISION.STOP,
        REDIRECT: PLAYER_ACTION_VEHICLE_DECISION.REDIRECT,
        STOP_FOR_EXIT: PLAYER_ACTION_VEHICLE_DECISION.STOP_FOR_EXIT
    };
    if (!Object.hasOwn(values, normalized)) {
        throw new Error('Player-action vehicle decision must be exactly one allowed vehicle keyword.');
    }
    const value = values[normalized];
    let allowed = [];
    if (movement === PLAYER_ACTION_MOVEMENT.INSIDE_VEHICLE) {
        allowed = [PLAYER_ACTION_VEHICLE_DECISION.UNCHANGED];
    } else if (movement === PLAYER_ACTION_MOVEMENT.DISEMBARK) {
        allowed = isUnderway === true
            ? [PLAYER_ACTION_VEHICLE_DECISION.UNCHANGED, PLAYER_ACTION_VEHICLE_DECISION.STOP_FOR_EXIT]
            : [PLAYER_ACTION_VEHICLE_DECISION.UNCHANGED];
    } else if (movement === PLAYER_ACTION_MOVEMENT.NONE) {
        allowed = isUnderway === true
            ? [
                PLAYER_ACTION_VEHICLE_DECISION.UNCHANGED,
                PLAYER_ACTION_VEHICLE_DECISION.STOP,
                PLAYER_ACTION_VEHICLE_DECISION.REDIRECT
            ]
            : [PLAYER_ACTION_VEHICLE_DECISION.UNCHANGED, PLAYER_ACTION_VEHICLE_DECISION.DEPART];
    }
    if (!allowed.includes(value)) {
        throw new Error(`Vehicle decision ${normalized} is not valid for the current movement and vehicle state.`);
    }
    return { value };
}

function parsePlayerActionProseScope(response) {
    const normalized = normalizeCompactChoiceResponse(response, 'player-action prose scope').toUpperCase();
    const rawValues = normalized
        .split(/\s*(?:,|;|\r?\n|\band\b)\s*/i)
        .map(value => value.replace(/^[-*]\s*/, '').trim())
        .filter(Boolean);
    if (!rawValues.length) {
        throw new Error('Player-action prose scope requires at least one scope.');
    }
    const values = {
        ORIGIN: PLAYER_ACTION_PROSE_SCOPE.ORIGIN,
        BETWEEN: PLAYER_ACTION_PROSE_SCOPE.BETWEEN,
        DESTINATION: PLAYER_ACTION_PROSE_SCOPE.DESTINATION
    };
    const seen = new Set();
    for (const rawValue of rawValues) {
        if (!Object.hasOwn(values, rawValue)) {
            throw new Error(`Unknown player-action prose scope "${rawValue}".`);
        }
        const value = values[rawValue];
        seen.add(value);
    }
    const canonicalOrder = Object.values(PLAYER_ACTION_PROSE_SCOPE).filter(value => seen.has(value));
    return { value: canonicalOrder };
}

function parsePlayerActionDestination(response) {
    const normalized = normalizePlainResponse(response, 'player-action destination');
    rejectPlayerActionResultMarkup(normalized, 'Player-action destination');
    const fields = new Map();
    const lines = normalized
        .replace(/^answer\s*:\s*/i, '')
        .split(/\r?\n/)
        .map(line => line.replace(/^\s*[-*]\s*/, '').trim())
        .filter(Boolean);
    for (const line of lines) {
        const match = line.match(/^(Location|Region):\s*(.+)$/i);
        if (!match) {
            throw new Error('Player-action destination must contain only Location and Region lines.');
        }
        const key = match[1].toLowerCase();
        if (fields.has(key)) {
            throw new Error(`Player-action destination contains duplicate ${match[1]} lines.`);
        }
        fields.set(key, match[2]);
    }
    if (fields.size !== 2 || !fields.has('location') || !fields.has('region')) {
        throw new Error('Player-action destination must contain exactly Location and Region lines.');
    }
    const normalizeValue = (value) => {
        const trimmed = value.trim();
        return /^n\s*\/\s*a\.?$/i.test(trimmed) ? null : trimmed;
    };
    const location = normalizeValue(fields.get('location'));
    const region = normalizeValue(fields.get('region'));
    if (!location && !region) {
        throw new Error('Player-action destination requires a location or region.');
    }
    return { value: { location, region } };
}

function parsePlayerActionDuration(response, minimumMinutes = 1) {
    const normalized = normalizePlainResponse(response, 'player-action duration');
    if (!Number.isInteger(minimumMinutes) || minimumMinutes < 0) {
        throw new RangeError('Player-action duration minimum must be a non-negative integer.');
    }
    rejectPlayerActionResultMarkup(normalized, 'Player-action duration');
    let minutes;
    try {
        minutes = Utils.parseDurationToMinutes(normalized, {
            fieldName: 'player-action duration'
        });
    } catch (error) {
        throw new Error(`Player-action duration is invalid: ${error.message}`);
    }
    if (!Number.isInteger(minutes) || minutes < minimumMinutes) {
        throw new Error(`Player-action duration must resolve to an integer of at least ${minimumMinutes} minutes.`);
    }
    return { value: { text: normalized, minutes } };
}

function parsePlayerActionAccompanyingCharacters(response, allowedCharacters = []) {
    const normalized = normalizeCompactChoiceResponse(response, 'player-action accompanying characters');
    rejectPlayerActionResultMarkup(normalized, 'Player-action accompanying characters');
    if (/^none$/i.test(normalized)) {
        return { value: [] };
    }
    let identifiers = normalized
        .split(/\r?\n/)
        .map(value => value.replace(/^\s*[-*]\s*/, '').trim())
        .filter(Boolean);
    if (identifiers.some(value => !value)) {
        throw new Error('Player-action accompanying characters must use one exact character name or alias per non-empty line.');
    }
    if (identifiers.length === 1 && identifiers[0].includes(',')) {
        try {
            return {
                value: normalizePlayerActionAccompanyingCharacterSelection(
                    identifiers,
                    allowedCharacters
                )
            };
        } catch (wholeIdentifierError) {
            identifiers = identifiers[0].split(',').map(value => value.trim()).filter(Boolean);
        }
    }
    return {
        value: normalizePlayerActionAccompanyingCharacterSelection(
            identifiers,
            allowedCharacters
        )
    };
}

function parsePlayerActionRequiredProse(response) {
    const normalized = normalizePlainResponse(response, 'player-action prose');
    rejectPlayerActionResultMarkup(normalized, 'Player-action prose', { rejectHidden: true });
    return { value: normalized };
}

function parsePlayerActionHiddenNotes(response) {
    const normalized = normalizePlainResponse(response, 'player-action hidden notes');
    if (/^n\s*\/\s*a\.?$/i.test(normalized)) {
        return { value: null };
    }
    rejectPlayerActionResultMarkup(normalized, 'Player-action hidden notes', { rejectHidden: true });
    return { value: normalized };
}

function parsePlayerActionTimeReasoning(response) {
    const normalized = normalizePlainResponse(response, 'player-action time reasoning');
    rejectPlayerActionResultMarkup(normalized, 'Player-action time reasoning', { rejectHidden: true });
    return { value: normalized };
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
    return { value: parsed.xml, normalizedResponse: parsed.xml };
}

function parseNeedBarCharactersResult(response, allowedNeedBarIds = []) {
    if (
        !Array.isArray(allowedNeedBarIds)
        || allowedNeedBarIds.some(id => typeof id !== 'string' || !id.trim())
    ) {
        throw new TypeError('Need-bar characters parser requires an array of non-empty need-bar ids.');
    }

    const { xml, root } = parseStrictXml(response, 'need-bar characters result');
    if (normalizedTagName(root) !== 'characters') {
        throw new Error('Need-bar characters result must use <characters> as its document root.');
    }
    rejectUnexpectedDirectChildren(root, ['character'], 'Need-bar characters result');

    const allowedIds = new Map(
        allowedNeedBarIds.map(id => [id.trim().toLowerCase(), id.trim()])
    );
    const seenCharacters = new Set();
    for (const characterNode of directChildrenByTagName(root, 'character')) {
        rejectUnexpectedDirectChildren(
            characterNode,
            ['name', 'affectedNeedBars'],
            'Need-bar character'
        );
        const characterName = requireSingleDirectChild(
            characterNode,
            'name',
            'Need-bar character'
        ).text;
        const characterKey = characterName.toLowerCase();
        if (seenCharacters.has(characterKey)) {
            throw new Error(`Need-bar characters result contains duplicate character "${characterName}".`);
        }
        seenCharacters.add(characterKey);

        const affectedNeedBars = requireSingleDirectChild(
            characterNode,
            'affectedNeedBars',
            'Need-bar character',
            { allowEmpty: true }
        ).node;
        rejectUnexpectedDirectChildren(
            affectedNeedBars,
            ['needBar'],
            `Need-bar character "${characterName}"`
        );
        const needBarNodes = directChildrenByTagName(affectedNeedBars, 'needBar');
        if (!needBarNodes.length) {
            throw new Error(
                `Need-bar character "${characterName}" must contain at least one affected <needBar>.`
            );
        }

        const seenNeedBars = new Set();
        for (const needBarNode of needBarNodes) {
            rejectUnexpectedDirectChildren(
                needBarNode,
                ['id', 'changeDirection', 'change', 'reason'],
                `Need-bar entry for "${characterName}"`
            );
            const id = requireSingleDirectChild(
                needBarNode,
                'id',
                `Need-bar entry for "${characterName}"`
            ).text;
            const idKey = id.toLowerCase();
            if (seenNeedBars.has(idKey)) {
                throw new Error(
                    `Need-bar character "${characterName}" contains duplicate need bar "${id}".`
                );
            }
            seenNeedBars.add(idKey);
            if (allowedIds.size && !allowedIds.has(idKey)) {
                throw new Error(`Need-bar characters result contains unknown need-bar id "${id}".`);
            }

            const direction = requireSingleDirectChild(
                needBarNode,
                'changeDirection',
                `Need-bar entry for "${characterName}"`
            ).text.toLowerCase();
            if (!['increase', 'decrease'].includes(direction)) {
                throw new Error('Need-bar <changeDirection> must be exactly increase or decrease.');
            }

            const magnitude = requireSingleDirectChild(
                needBarNode,
                'change',
                `Need-bar entry for "${characterName}"`
            ).text.toLowerCase();
            if (!['small', 'medium', 'large', 'all', 'full', 'empty'].includes(magnitude)) {
                throw new Error(
                    'Need-bar <change> must be exactly small, medium, large, all, full, or empty.'
                );
            }

            requireSingleDirectChild(
                needBarNode,
                'reason',
                `Need-bar entry for "${characterName}"`
            );
        }
    }

    return { value: xml, normalizedResponse: xml };
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
    return {
        value: { revise, issues: issueText, xml },
        normalizedResponse: xml
    };
}

function parseAllowedCharacterSelection(response, allowedNames, minimum = 0, maximum = 3) {
    if (!Array.isArray(allowedNames) || allowedNames.some(name => typeof name !== 'string' || !name.trim())) {
        throw new TypeError('Allowed character selection requires an array of non-empty names.');
    }
    if (!Number.isInteger(minimum) || !Number.isInteger(maximum) || minimum < 0 || maximum < minimum) {
        throw new RangeError('Allowed character selection requires valid integer bounds.');
    }
    const { xml, root } = parseStrictXml(response, 'character selection');
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
    return { value: resolved, normalizedResponse: xml };
}

function parseNarrativeScope(response) {
    const { xml, root } = parseStrictXml(response, 'narrative scope');
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
        },
        normalizedResponse: xml
    };
}

function parseOutcomeAcknowledgement(response, expectedFacts = []) {
    if (!Array.isArray(expectedFacts) || expectedFacts.some(fact => typeof fact !== 'string' || !fact.trim())) {
        throw new TypeError('Outcome acknowledgement requires an array of non-empty expected facts.');
    }
    const { xml, root } = parseStrictXml(response, 'outcome acknowledgement');
    if (normalizedTagName(root) !== 'outcomeacknowledgement') {
        throw new Error('Outcome acknowledgement must use <outcomeAcknowledgement> as its document root.');
    }
    rejectUnexpectedDirectChildren(root, ['fact'], 'Outcome acknowledgement');
    const facts = directChildrenByTagName(root, 'fact').map(node => String(node.textContent || '').trim());
    if (facts.length !== expectedFacts.length) {
        throw new Error(`Outcome acknowledgement requires exactly ${expectedFacts.length} facts.`);
    }
    const unmatchedFacts = [...facts];
    expectedFacts.forEach((expected) => {
        const index = unmatchedFacts.indexOf(expected);
        if (index < 0) {
            throw new Error(`Outcome acknowledgement must include exact fact "${expected}".`);
        }
        unmatchedFacts.splice(index, 1);
    });
    return { value: facts, normalizedResponse: xml };
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
        },
        normalizedResponse: xml
    };
}

function parseGameIntroResult(response) {
    const { xml, root } = parseStrictXml(response, 'game intro result');
    if (normalizedTagName(root) !== 'gameintro') {
        throw new Error('Game intro result must use <gameIntro> as its document root.');
    }
    rejectUnexpectedDirectChildren(root, ['introprose'], 'Game intro result');
    requireSingleDirectChild(root, 'introProse', 'Game intro result');
    return { value: xml, normalizedResponse: xml };
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
    return { value: xml, normalizedResponse: xml };
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
        let parsedDurationMinutes;
        try {
            parsedDurationMinutes = Utils.parseDurationToMinutes(durationText, {
                fieldName: 'craft narrative duration'
            });
        } catch (error) {
            throw new Error(`Craft narrative duration is invalid: ${error.message}`);
        }
        if (parsedDurationMinutes !== expectedDurationMinutes) {
            throw new Error(
                `Craft narrative duration must resolve to exactly ${expectedDurationMinutes} minutes.`
            );
        }
    }
    return { value: xml, normalizedResponse: xml };
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

function parseContainerOpenNarrativeResult(response, {
    expectedToolName = null,
    expectedSuccess = null
} = {}) {
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
    const checkResult = requireSingleDirectChild(root, 'checkResult', 'Container open result').text;
    const success = parseBooleanText(
        requireSingleDirectChild(root, 'success', 'Container open result').text,
        'Container open result <success>'
    );
    if (expectedSuccess !== null && typeof expectedSuccess !== 'boolean') {
        throw new TypeError('Container open expected success must be a boolean when provided.');
    }
    if (expectedSuccess !== null && success !== expectedSuccess) {
        throw new Error(
            `Container open result <success> must match the authoritative check result (${expectedSuccess}).`
        );
    }
    const permanentlyOpened = parseBooleanText(
        requireSingleDirectChild(root, 'permanentlyOpened', 'Container open result').text,
        'Container open result <permanentlyOpened>'
    );
    if (!success && permanentlyOpened) {
        throw new Error('A failed container-open check cannot permanently open the container.');
    }
    const prose = requireSingleDirectChild(root, 'prose', 'Container open result').text;
    const timePassedNode = requireSingleDirectChild(root, 'timePassed', 'Container open result').node;
    const durationText = requireSingleDirectChild(
        timePassedNode,
        'duration',
        'Container open result <timePassed>'
    ).text;
    let timePassedMinutes;
    try {
        timePassedMinutes = Utils.parseDurationToMinutes(durationText, {
            fieldName: 'container open result duration'
        });
    } catch (error) {
        throw new Error(`Container open result duration is invalid: ${error.message}`);
    }
    return {
        value: xml,
        normalizedResponse: xml,
        semantic: {
            toolUsed,
            checkResult,
            success,
            permanentlyOpened,
            prose,
            timePassedMinutes
        }
    };
}

function parseWhileYouWereAwayResult(response) {
    const { xml, root } = parseStrictXml(response, 'while-you-were-away result');
    if (normalizedTagName(root) !== 'response') {
        throw new Error('While-you-were-away result must use <response> as its document root.');
    }
    rejectUnexpectedDirectChildren(root, ['proseforplayer', 'characterupdates', 'itemscenerymoves'], 'While-you-were-away result');
    requireSingleDirectChild(root, 'proseForPlayer', 'While-you-were-away result');
    const characterUpdatesRoot = requireSingleDirectChild(
        root,
        'characterUpdates',
        'While-you-were-away result',
        { allowEmpty: true }
    ).node;
    validateWhileAwayCharacterUpdatesRoot(characterUpdatesRoot, {
        label: 'While-you-were-away result <characterUpdates>'
    });
    const itemSceneryMovesRoot = requireSingleDirectChild(
        root,
        'itemSceneryMoves',
        'While-you-were-away result',
        { allowEmpty: true }
    ).node;
    validateWhileAwayItemSceneryMovesRoot(itemSceneryMovesRoot, {
        label: 'While-you-were-away result <itemSceneryMoves>'
    });
    return { value: xml, normalizedResponse: xml };
}

function validateWhileAwayTravelDestination(node, {
    label,
    requireHere = false
} = {}) {
    if (!node) {
        if (requireHere) {
            throw new Error(`${label} requires <travelDestination>HERE</travelDestination>.`);
        }
        return;
    }
    rejectUnexpectedDirectChildren(node, ['location', 'region'], `${label} <travelDestination>`);
    const children = directChildElements(node);
    if (requireHere) {
        if (children.length || String(node.textContent || '').trim().toUpperCase() !== 'HERE') {
            throw new Error(`${label} requires <travelDestination>HERE</travelDestination>.`);
        }
        return;
    }
    if (!children.length) {
        throw new Error(
            `${label} <travelDestination> must use <location> and/or <region> child tags.`
        );
    }
    if (directChildrenByTagName(node, 'location').length > 1 || directChildrenByTagName(node, 'region').length > 1) {
        throw new Error(`${label} <travelDestination> may contain at most one <location> and one <region>.`);
    }
    const destinationParts = children.map(child => String(child.textContent || '').trim()).filter(Boolean);
    if (!destinationParts.length) {
        throw new Error(`${label} requires a non-empty destination location or region.`);
    }
}

function validateWhileAwayNeedBarValue(value, label) {
    const normalized = String(value || '').trim();
    if (/^n\s*\/\s*a\.?$/i.test(normalized)) {
        return;
    }
    const match = normalized.match(/^(\d+(?:\.\d+)?)\s*%?$/);
    if (!match) {
        throw new Error(`${label} must be a percentage from 0 to 100 or N/A.`);
    }
    const numeric = Number(match[1]);
    if (!Number.isFinite(numeric) || numeric < 0 || numeric > 100) {
        throw new Error(`${label} must be between 0 and 100 percent.`);
    }
}

function validateWhileAwayCharacterUpdateElement(root, {
    expectedName = null,
    label = 'While-you-were-away character update',
    requireHere = false
} = {}) {
    if (normalizedTagName(root) !== 'characterupdate') {
        throw new Error(`${label} must use <characterUpdate> as its document root.`);
    }
    rejectUnexpectedDirectChildren(
        root,
        ['name', 'needbarchanges', 'traveldestination', 'update'],
        label
    );
    const name = requireSingleDirectChild(root, 'name', label).text;
    if (expectedName !== null && name !== expectedName) {
        throw new Error(`${label} name must exactly match "${expectedName}".`);
    }

    const needBarChangesRoot = requireSingleDirectChild(
        root,
        'needBarChanges',
        label,
        { allowEmpty: true }
    ).node;
    rejectUnexpectedDirectChildren(needBarChangesRoot, ['needbareffect'], `${label} <needBarChanges>`);
    const seenNeedBarIds = new Set();
    for (const [index, effectNode] of directChildrenByTagName(needBarChangesRoot, 'needBarEffect').entries()) {
        const effectLabel = `${label} needBarEffect #${index + 1}`;
        rejectUnexpectedDirectChildren(effectNode, ['needbarid', 'value'], effectLabel);
        const needBarId = requireSingleDirectChild(effectNode, 'needBarId', effectLabel).text;
        const value = requireSingleDirectChild(effectNode, 'value', effectLabel).text;
        validateWhileAwayNeedBarValue(value, `${effectLabel} <value>`);
        const needBarKey = needBarId.toLowerCase();
        if (seenNeedBarIds.has(needBarKey)) {
            throw new Error(`${label} contains duplicate need bar "${needBarId}".`);
        }
        seenNeedBarIds.add(needBarKey);
    }

    const travelDestinationNodes = directChildrenByTagName(root, 'travelDestination');
    if (travelDestinationNodes.length > 1) {
        throw new Error(`${label} may contain at most one <travelDestination>.`);
    }
    validateWhileAwayTravelDestination(travelDestinationNodes[0] || null, { label, requireHere });
    requireSingleDirectChild(root, 'update', label);
    return name;
}

function validateWhileAwayCharacterUpdatesRoot(root, {
    label = 'While-you-were-away character updates',
    requireHere = false
} = {}) {
    rejectUnexpectedDirectChildren(root, ['characterupdate'], label);
    const seenNames = new Set();
    for (const [index, updateNode] of directChildrenByTagName(root, 'characterUpdate').entries()) {
        const name = validateWhileAwayCharacterUpdateElement(updateNode, {
            label: `${label} entry #${index + 1}`,
            requireHere
        });
        const nameKey = name.toLowerCase();
        if (seenNames.has(nameKey)) {
            throw new Error(`${label} contains duplicate character "${name}".`);
        }
        seenNames.add(nameKey);
    }
}

function validateWhileAwayItemSceneryMovesRoot(root, {
    label = 'While-you-were-away item/scenery moves'
} = {}) {
    rejectUnexpectedDirectChildren(root, ['itemname'], label);
    const seenNames = new Set();
    for (const [index, itemNode] of directChildrenByTagName(root, 'itemName').entries()) {
        const name = String(itemNode.textContent || '').trim();
        if (!name) {
            throw new Error(`${label} itemName #${index + 1} must not be empty.`);
        }
        const nameKey = name.toLowerCase();
        if (seenNames.has(nameKey)) {
            throw new Error(`${label} contains duplicate item/scenery name "${name}".`);
        }
        seenNames.add(nameKey);
    }
}

function parseWhileAwayCharacterUpdate(response, expectedName) {
    if (typeof expectedName !== 'string' || !expectedName.trim()) {
        throw new TypeError('While-you-were-away character update requires an expected name.');
    }
    const { xml, root } = parseStrictXml(response, 'while-you-were-away character update');
    const trimmedExpectedName = expectedName.trim();
    const name = validateWhileAwayCharacterUpdateElement(root, {
        expectedName: trimmedExpectedName,
        label: 'While-you-were-away character update'
    });
    return {
        value: { xml, name },
        normalizedResponse: xml
    };
}

function parseWhileAwayArrivalUpdates(response) {
    const { xml, root } = parseStrictXml(response, 'while-you-were-away arrival updates');
    if (normalizedTagName(root) !== 'characterupdates') {
        throw new Error('While-you-were-away arrival updates must use <characterUpdates> as its document root.');
    }
    validateWhileAwayCharacterUpdatesRoot(root, {
        label: 'While-you-were-away arrival updates',
        requireHere: true
    });
    return { value: xml, normalizedResponse: xml };
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
    const finalUpdatesByName = new Map(finalUpdateNodes.map(node => [
        requireSingleDirectChild(node, 'name', 'Final staged while-you-were-away character update').text.toLowerCase(),
        node
    ]));
    expectedUpdateNodes.forEach((expectedNode, index) => {
        const expectedName = requireSingleDirectChild(
            expectedNode,
            'name',
            `Staged while-you-were-away character update ${index + 1}`
        ).text;
        const finalNode = finalUpdatesByName.get(expectedName.toLowerCase());
        if (
            !finalNode
            || JSON.stringify(canonicalizeXmlElement(expectedNode))
                !== JSON.stringify(canonicalizeXmlElement(finalNode))
        ) {
            throw new Error(`Final while-you-were-away response changed staged character update "${expectedName}".`);
        }
    });
    const expectedMoveRoot = parseXmlRootForComparison(
        itemSceneryMovesXml,
        'itemSceneryMoves',
        'staged item/scenery moves'
    );
    const canonicalItemNames = root => directChildrenByTagName(root, 'itemName')
        .map(node => String(node.textContent || '').replace(/\s+/g, ' ').trim().toLowerCase())
        .sort();
    if (JSON.stringify(canonicalItemNames(expectedMoveRoot)) !== JSON.stringify(canonicalItemNames(finalMoveRoot))) {
        throw new Error('Final while-you-were-away response changed the staged item/scenery moves.');
    }
    return {
        ...parsedFinal,
        normalizedResponse: parsedFinal.value
    };
}

function parseScheduledEventNarrativeResult(response) {
    const { xml, root } = parseStrictXml(response, 'scheduled event result');
    if (normalizedTagName(root) !== 'scheduledeventresult') {
        throw new Error('Scheduled event result must use <scheduledEventResult> as its document root.');
    }
    rejectUnexpectedDirectChildren(root, ['summary', 'proseforplayer'], 'Scheduled event result');
    const children = directChildElements(root);
    if (!children.length) {
        return { value: xml, normalizedResponse: xml };
    }
    requireSingleDirectChild(root, 'summary', 'Scheduled event result');
    if (directChildrenByTagName(root, 'proseForPlayer').length > 1) {
        throw new Error('Scheduled event result may contain at most one <proseForPlayer>.');
    }
    return { value: xml, normalizedResponse: xml };
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
    return {
        value: finalParsed.xml,
        normalizedResponse: finalParsed.xml
    };
}

module.exports = {
    parseAllowedCharacterSelection,
    parseContainerOpenNarrativeResult,
    parseCraftNarrativeResult,
    parseExactXmlRoot,
    parseGameIntroResult,
    parseLocationModificationNarrativeResult,
    parseNeedBarCharactersResult,
    parseNarrativeScope,
    parseOutcomeAcknowledgement,
    parsePlayerActionDestination,
    parsePlayerActionDuration,
    parsePlayerActionAccompanyingCharacters,
    parsePlayerActionHiddenNotes,
    parsePlayerActionMovement,
    parsePlayerActionProseScope,
    parsePlayerActionRequiredProse,
    parsePlayerActionTimeReasoning,
    parsePlayerActionVehicleDecision,
    parseQuestRewardResult,
    parseRevisionDecision,
    parseScheduledEventNarrativeResult,
    parseScheduledEventInterruptionRewrite,
    parseScheduledEventStagedResult,
    parseTurnNarrativeResult,
    parseWhileAwayArrivalUpdates,
    parseWhileAwayCharacterUpdate,
    parseWhileYouWereAwayResult,
    parseWhileYouWereAwayStagedResult
};
