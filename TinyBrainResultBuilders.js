const Utils = require('./Utils.js');

function requireObject(value, label) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        throw new TypeError(`${label} must be an object.`);
    }
    return value;
}

function requireText(value, label) {
    if (typeof value !== 'string' || !value.trim()) {
        throw new Error(`${label} must be a non-empty string.`);
    }
    return value.trim();
}

function escapeXmlText(value) {
    return String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
}

function wrapCdata(value) {
    return `<![CDATA[${String(value ?? '').replace(/]]>/g, ']]]]><![CDATA[>')}]]>`;
}

function requireCheckpointValues(checkpointValues) {
    if (!Array.isArray(checkpointValues)) {
        throw new TypeError('Tiny-brain result builder checkpointValues must be an array.');
    }
    return checkpointValues;
}

function findApprovedProse(checkpointValues) {
    const values = requireCheckpointValues(checkpointValues);
    let revisionIndex = -1;
    for (let index = values.length - 1; index >= 0; index -= 1) {
        if (values[index]?.checkpoint?.parserName === 'revision_decision') {
            revisionIndex = index;
            break;
        }
    }
    if (revisionIndex < 0) {
        throw new Error('Tiny-brain prose result builder could not find a revision-decision checkpoint.');
    }
    const revisionDecision = requireObject(
        values[revisionIndex].value,
        'Tiny-brain revision decision'
    );
    const searchIndexes = [];
    if (revisionDecision.revise === true) {
        for (let index = revisionIndex + 1; index < values.length; index += 1) {
            searchIndexes.push(index);
        }
    } else if (revisionDecision.revise === false) {
        for (let index = revisionIndex - 1; index >= 0; index -= 1) {
            searchIndexes.push(index);
        }
    } else {
        throw new Error('Tiny-brain revision decision is missing its boolean revise value.');
    }
    for (const index of searchIndexes) {
        const entry = values[index];
        const isApprovedProseCheckpoint = entry?.checkpoint?.parserName === 'player_action_required_prose'
            || entry?.checkpoint?.parserName === 'player_action_optional_prose'
            || entry?.checkpoint?.kind === 'dummy';
        if (isApprovedProseCheckpoint && typeof entry.value === 'string' && entry.value.trim()) {
            return entry.value.trim();
        }
    }
    throw new Error('Tiny-brain prose result builder could not find the approved draft.');
}

function buildTurnResultFromApprovedProse({ checkpointValues }) {
    const prose = findApprovedProse(checkpointValues);
    return `<turnResult><prose>${wrapCdata(prose)}</prose></turnResult>`;
}

function buildGameIntroResult({ checkpointValues }) {
    const prose = findApprovedProse(checkpointValues);
    return `<gameIntro><introProse>${wrapCdata(prose)}</introProse></gameIntro>`;
}

function buildQuestRewardResult({ checkpointValues, templateContext }) {
    const prose = findApprovedProse(checkpointValues);
    const rewards = templateContext?.questRewards;
    if (!Array.isArray(rewards) || !rewards.length) {
        throw new Error('Quest-reward result builder requires at least one authoritative reward.');
    }
    const lines = [
        '<questRewardResult>',
        `  <prose>${wrapCdata(prose)}</prose>`
    ];
    rewards.forEach((reward, index) => {
        const text = requireText(String(reward ?? ''), `Quest reward ${index + 1}`);
        lines.push(
            '  <rewardCoverage>',
            `    <index>${index + 1}</index>`,
            `    <included>${escapeXmlText(text)}</included>`,
            '  </rewardCoverage>'
        );
    });
    lines.push('</questRewardResult>');
    return lines.join('\n');
}

function buildWhileYouWereAwayResult({ checkpointValues }) {
    const values = requireCheckpointValues(checkpointValues);
    const characterUpdates = values
        .filter(entry => entry?.checkpoint?.parserName === 'while_away_character_update')
        .map((entry, index) => requireText(
            entry?.value?.xml,
            `While-you-were-away character update ${index + 1}`
        ));
    const arrivalEntry = values.find(
        entry => entry?.checkpoint?.parserName === 'while_away_arrival_updates'
    );
    const movesEntry = values.find(entry => (
        entry?.checkpoint?.parserName === 'exact_xml_root'
        && entry?.checkpoint?.parserArgs?.[0] === 'itemSceneryMoves'
    ));
    const arrivalXml = requireText(arrivalEntry?.value, 'While-you-were-away arrival updates');
    const movesXml = requireText(movesEntry?.value, 'While-you-were-away item/scenery moves');
    const arrivalDoc = Utils.parseXmlDocumentStrict(arrivalXml, 'text/xml');
    const movesDoc = Utils.parseXmlDocumentStrict(movesXml, 'text/xml');
    const arrivalChildren = Array.from(arrivalDoc.documentElement?.childNodes || [])
        .filter(node => node?.nodeType === 1)
        .map(node => node.toString());
    const moveChildren = Array.from(movesDoc.documentElement?.childNodes || [])
        .filter(node => node?.nodeType === 1)
        .map(node => node.toString());
    const optionalProseEntry = values.find(
        entry => entry?.checkpoint?.parserName === 'player_action_optional_prose'
    );
    const prose = optionalProseEntry
        ? (
            typeof optionalProseEntry.value === 'string' && optionalProseEntry.value.trim()
                ? findApprovedProse(values)
                : ''
        )
        : findApprovedProse(values);
    return [
        '<response>',
        ...(prose ? [`  <proseForPlayer>${wrapCdata(prose)}</proseForPlayer>`] : []),
        '  <characterUpdates>',
        ...characterUpdates.map(xml => `    ${xml}`),
        ...arrivalChildren.map(xml => `    ${xml}`),
        '  </characterUpdates>',
        '  <itemSceneryMoves>',
        ...moveChildren.map(xml => `    ${xml}`),
        '  </itemSceneryMoves>',
        '</response>'
    ].join('\n');
}

function buildScheduledEventResult({ assignments, checkpointValues, templateContext }) {
    if (assignments.scheduledEventApplies !== true) {
        return '<scheduledEventResult/>';
    }
    const summary = requireText(assignments.scheduledEventSummary, 'Scheduled-event summary');
    const lines = [
        '<scheduledEventResult>',
        `  <summary>${escapeXmlText(summary)}</summary>`
    ];
    if (templateContext?.scheduledEventPlayerPresent === true) {
        lines.push(`  <proseForPlayer>${wrapCdata(findApprovedProse(checkpointValues))}</proseForPlayer>`);
    }
    lines.push('</scheduledEventResult>');
    return lines.join('\n');
}

function buildScheduledEventInterruptionResult({ checkpointValues, templateContext }) {
    const originalXml = requireText(
        templateContext?.originalXml,
        'Scheduled-event interruption original XML'
    );
    const doc = Utils.parseXmlDocumentStrict(originalXml, 'text/xml');
    const root = doc.documentElement;
    const rootName = String(root?.tagName || '').toLowerCase();
    if (rootName !== 'turnresult') {
        throw new Error('Tiny-brain scheduled-event interruption builder currently requires <turnResult>.');
    }
    const proseNodes = Array.from(root.childNodes || []).filter(node => (
        node?.nodeType === 1 && String(node.tagName || '').toLowerCase() === 'prose'
    ));
    if (proseNodes.length !== 1) {
        throw new Error('Scheduled-event interruption <turnResult> requires exactly one direct <prose> child.');
    }
    const proseNode = proseNodes[0];
    while (proseNode.firstChild) {
        proseNode.removeChild(proseNode.firstChild);
    }
    proseNode.appendChild(doc.createCDATASection(findApprovedProse(checkpointValues)));
    return root.toString();
}

function buildSceneSummaryResult({ assignments, checkpointValues, templateContext }) {
    const boundaries = assignments?.sceneBoundaries;
    if (!Array.isArray(boundaries) || boundaries.length < 2) {
        throw new Error(
            'Scene-summary result builder requires at least two approved scene boundaries.'
        );
    }
    const fullHistoryLines = templateContext?.fullHistoryLines;
    if (!Array.isArray(fullHistoryLines) || !fullHistoryLines.length) {
        throw new Error('Scene-summary result builder requires non-empty indexed history lines.');
    }

    const normalizedBoundaries = boundaries.map((boundary, index) => {
        const record = requireObject(boundary, `Scene-summary boundary ${index + 1}`);
        const start = Number(record.index);
        if (!Number.isInteger(start) || start <= 0 || start > fullHistoryLines.length) {
            throw new Error(
                `Scene-summary boundary ${index + 1} must be inside entries 1-${fullHistoryLines.length}.`
            );
        }
        if (index > 0 && start <= Number(boundaries[index - 1]?.index)) {
            throw new Error('Scene-summary result boundaries must be strictly ascending.');
        }
        return start;
    });
    const sceneEntries = requireCheckpointValues(checkpointValues)
        .filter(entry => entry?.checkpoint?.parserName === 'scene_summary_entry')
        .map((entry, index) => requireObject(
            entry.value,
            `Scene-summary entry ${index + 1}`
        ));
    if (sceneEntries.length !== normalizedBoundaries.length - 1) {
        throw new Error(
            `Scene-summary result expected ${normalizedBoundaries.length - 1} summarized entries but found ${sceneEntries.length}.`
        );
    }

    const lines = ['<scenes>'];
    sceneEntries.forEach((scene, index) => {
        const expectedStart = normalizedBoundaries[index];
        const expectedEnd = normalizedBoundaries[index + 1] - 1;
        if (scene.localStartIndex !== expectedStart || scene.localEndIndex !== expectedEnd) {
            throw new Error(
                `Scene-summary entry ${index + 1} does not match approved range ${expectedStart}-${expectedEnd}.`
            );
        }
        const details = Array.isArray(scene.details) ? scene.details : null;
        const quotes = Array.isArray(scene.quotes) ? scene.quotes : null;
        if (!details || !quotes) {
            throw new Error(`Scene-summary entry ${index + 1} has invalid details or quotes.`);
        }
        lines.push(
            '  <scene>',
            `    <index>${expectedStart}</index>`,
            `    <summary>${wrapCdata(requireText(scene.summary, `Scene-summary entry ${index + 1} summary`))}</summary>`,
            '    <details>'
        );
        for (const detail of details) {
            lines.push(`      ${escapeXmlText(requireText(detail, `Scene-summary entry ${index + 1} detail`))}`);
        }
        lines.push('    </details>');
        for (const quote of quotes) {
            const record = requireObject(quote, `Scene-summary entry ${index + 1} quote`);
            lines.push(
                '    <quote>',
                `      <character>${escapeXmlText(requireText(record.character, 'Scene-summary quote character'))}</character>`,
                `      <text>${escapeXmlText(requireText(record.text, 'Scene-summary quote text'))}</text>`,
                '    </quote>'
            );
        }
        lines.push('  </scene>');
    });

    const followingSceneStart = normalizedBoundaries[normalizedBoundaries.length - 1];
    lines.push(
        '  <scene>',
        `    <index>${followingSceneStart}</index>`,
        '    <summary>Following scene boundary marker.</summary>',
        '    <details></details>',
        '  </scene>',
        '</scenes>'
    );
    return lines.join('\n');
}

function buildCraftResult({ assignments, checkpointValues, templateContext }) {
    const duration = Number(templateContext?.authoritativeTimePassedMinutes);
    if (!Number.isInteger(duration) || duration < 1) {
        throw new Error('Craft result builder requires a positive authoritative duration.');
    }
    const lines = [
        '<result>',
        `  <description>${wrapCdata(findApprovedProse(checkpointValues))}</description>`
    ];
    if (templateContext?.otherEffect) {
        lines.push(
            `  <otherEffectDescription>${wrapCdata(requireText(assignments.otherEffectProse, 'Craft other-effect prose'))}</otherEffectDescription>`
        );
    }
    lines.push(
        '  <timePassed>',
        `    <reasoning>${escapeXmlText(requireText(assignments.timeReasoning, 'Craft time reasoning'))}</reasoning>`,
        `    <duration>${duration} minutes</duration>`,
        '  </timePassed>',
        '</result>'
    );
    return lines.join('\n');
}

function buildLocationModificationResult({ assignments, checkpointValues, templateContext }) {
    const duration = Number(templateContext?.authoritativeTimePassedMinutes);
    if (!Number.isInteger(duration) || duration < 1) {
        throw new Error('Location-modification result builder requires a positive authoritative duration.');
    }
    const effect = templateContext?.otherEffect
        ? wrapCdata(requireText(assignments.otherEffectProse, 'Location-modification effect prose'))
        : 'N/A';
    return [
        '<result>',
        `  <description>${wrapCdata(findApprovedProse(checkpointValues))}</description>`,
        `  <otherEffectDescription>${effect}</otherEffectDescription>`,
        '  <timePassed>',
        `    <reasoning>${escapeXmlText(requireText(assignments.timeReasoning, 'Location-modification time reasoning'))}</reasoning>`,
        `    <duration>${duration} minutes</duration>`,
        '  </timePassed>',
        '</result>'
    ].join('\n');
}

function buildContainerOpenResult({ assignments, checkpointValues, toolInvocations }) {
    const checkInvocations = (Array.isArray(toolInvocations) ? toolInvocations : []).filter(invocation => (
        invocation?.name === 'resolveSkillCheck' || invocation?.name === 'resolveOpposedSkillCheck'
    ));
    if (checkInvocations.length !== 1 || checkInvocations[0]?.metadata?.error === true) {
        throw new Error('Container-open result builder requires exactly one successful check invocation.');
    }
    const invocation = checkInvocations[0];
    const resolution = requireObject(
        invocation?.metadata?.actionResolution,
        'Container-open action resolution'
    );
    if (typeof resolution.success !== 'boolean') {
        throw new Error('Container-open action resolution is missing its success value.');
    }
    const permanentlyOpened = assignments.permanentlyOpened === true;
    if (!resolution.success && permanentlyOpened) {
        throw new Error('A failed container-open check cannot permanently open the container.');
    }
    const resultLabel = requireText(
        resolution.label || resolution.degree || (resolution.success ? 'success' : 'failure'),
        'Container-open check result'
    );
    const duration = requireObject(assignments.timeDuration, 'Container-open duration');
    return [
        '<containerOpenResult>',
        `  <toolUsed>${invocation.name}</toolUsed>`,
        `  <checkResult>${escapeXmlText(resultLabel)}</checkResult>`,
        `  <success>${resolution.success}</success>`,
        `  <permanentlyOpened>${permanentlyOpened}</permanentlyOpened>`,
        `  <prose>${wrapCdata(findApprovedProse(checkpointValues))}</prose>`,
        '  <timePassed>',
        `    <reasoning>${escapeXmlText(requireText(assignments.timeReasoning, 'Container-open time reasoning'))}</reasoning>`,
        `    <duration>${escapeXmlText(requireText(duration.text, 'Container-open duration text'))}</duration>`,
        '  </timePassed>',
        '</containerOpenResult>'
    ].join('\n');
}

module.exports = {
    buildContainerOpenResult,
    buildCraftResult,
    buildGameIntroResult,
    buildLocationModificationResult,
    buildQuestRewardResult,
    buildSceneSummaryResult,
    buildScheduledEventInterruptionResult,
    buildScheduledEventResult,
    buildTurnResultFromApprovedProse,
    buildWhileYouWereAwayResult,
    findApprovedProse
};
