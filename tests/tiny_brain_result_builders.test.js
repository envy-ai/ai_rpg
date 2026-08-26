const test = require('node:test');
const assert = require('node:assert/strict');

const {
    buildContainerOpenResult,
    buildCraftResult,
    buildGameIntroResult,
    buildLocationModificationResult,
    buildQuestRewardResult,
    buildScheduledEventInterruptionResult,
    buildScheduledEventResult,
    buildTurnResultFromApprovedProse,
    buildWhileYouWereAwayResult,
    findApprovedProse
} = require('../TinyBrainResultBuilders.js');

function checkpoint(parserName, value, {
    kind = 'parse',
    parserArgs = []
} = {}) {
    return {
        checkpoint: { parserName, kind, parserArgs },
        value
    };
}

function approvedProseValues({ revise = false } = {}) {
    const values = [
        checkpoint('dummy', 'First approved draft.', { kind: 'dummy' }),
        checkpoint('revision_decision', { revise })
    ];
    if (revise) {
        values.push(checkpoint('dummy', 'Revised approved draft.', { kind: 'dummy' }));
    }
    return values;
}

function parsedApprovedProseValues({ revise = false } = {}) {
    const values = [
        checkpoint('player_action_required_prose', 'First parsed draft.'),
        checkpoint('revision_decision', { revise })
    ];
    if (revise) {
        values.push(checkpoint('player_action_required_prose', 'Revised parsed draft.'));
    }
    return values;
}

test('approved prose selection and simple result builders use the audited draft locally', () => {
    assert.equal(findApprovedProse(approvedProseValues()), 'First approved draft.');
    assert.equal(findApprovedProse(approvedProseValues({ revise: true })), 'Revised approved draft.');
    assert.equal(
        buildTurnResultFromApprovedProse({ checkpointValues: approvedProseValues() }),
        '<turnResult><prose><![CDATA[First approved draft.]]></prose></turnResult>'
    );
    assert.equal(
        buildGameIntroResult({ checkpointValues: approvedProseValues({ revise: true }) }),
        '<gameIntro><introProse><![CDATA[Revised approved draft.]]></introProse></gameIntro>'
    );
    assert.equal(findApprovedProse(parsedApprovedProseValues()), 'First parsed draft.');
    assert.equal(findApprovedProse(parsedApprovedProseValues({ revise: true })), 'Revised parsed draft.');
});

test('quest reward and while-away builders assemble already accepted structured data', () => {
    const rewardXml = buildQuestRewardResult({
        checkpointValues: approvedProseValues(),
        templateContext: { questRewards: ['10 gold & a smile', 'Moon key'] }
    });
    assert.match(rewardXml, /<prose><!\[CDATA\[First approved draft\.\]\]><\/prose>/);
    assert.match(rewardXml, /<included>10 gold &amp; a smile<\/included>/);
    assert.match(rewardXml, /<index>2<\/index>[\s\S]*<included>Moon key<\/included>/);

    const whileAwayXml = buildWhileYouWereAwayResult({
        checkpointValues: [
            checkpoint('while_away_character_update', {
                xml: '<characterUpdate><characterName>Mira</characterName><summary>Returned.</summary></characterUpdate>'
            }),
            checkpoint(
                'while_away_arrival_updates',
                '<characterUpdates><arrival><characterName>Ada</characterName></arrival></characterUpdates>'
            ),
            checkpoint(
                'exact_xml_root',
                '<itemSceneryMoves><itemMove><itemName>Toolbox</itemName></itemMove></itemSceneryMoves>',
                { parserArgs: ['itemSceneryMoves'] }
            ),
            ...approvedProseValues({ revise: true })
        ]
    });
    assert.match(whileAwayXml, /<proseForPlayer><!\[CDATA\[Revised approved draft\.\]\]><\/proseForPlayer>/);
    assert.match(whileAwayXml, /<characterName>Mira<\/characterName>/);
    assert.match(whileAwayXml, /<characterName>Ada<\/characterName>/);
    assert.match(whileAwayXml, /<itemName>Toolbox<\/itemName>/);

    const whileAwayWithoutProseXml = buildWhileYouWereAwayResult({
        checkpointValues: [
            checkpoint('while_away_arrival_updates', '<characterUpdates/>'),
            checkpoint('exact_xml_root', '<itemSceneryMoves/>', { parserArgs: ['itemSceneryMoves'] }),
            checkpoint('player_action_optional_prose', null)
        ]
    });
    assert.doesNotMatch(whileAwayWithoutProseXml, /<proseForPlayer>/);
    assert.match(whileAwayWithoutProseXml, /<characterUpdates>[\s\S]*<\/characterUpdates>/);
});

test('scheduled-event builders handle no-event, visible event, and interruption merge branches', () => {
    assert.equal(
        buildScheduledEventResult({
            assignments: { scheduledEventApplies: false },
            checkpointValues: [],
            templateContext: {}
        }),
        '<scheduledEventResult/>'
    );
    const visible = buildScheduledEventResult({
        assignments: {
            scheduledEventApplies: true,
            scheduledEventSummary: 'The bell rang & woke the guard.'
        },
        checkpointValues: approvedProseValues(),
        templateContext: { scheduledEventPlayerPresent: true }
    });
    assert.match(visible, /<summary>The bell rang &amp; woke the guard\.<\/summary>/);
    assert.match(visible, /<proseForPlayer><!\[CDATA\[First approved draft\.\]\]><\/proseForPlayer>/);

    const originalXml = '<turnResult><prose>Old prose.</prose><hidden>keep me</hidden>'
        + '<timePassed><duration>10 minutes</duration></timePassed></turnResult>';
    const rewritten = buildScheduledEventInterruptionResult({
        checkpointValues: approvedProseValues({ revise: true }),
        templateContext: { originalXml }
    });
    assert.match(rewritten, /<prose><!\[CDATA\[Revised approved draft\.\]\]><\/prose>/);
    assert.match(rewritten, /<hidden>keep me<\/hidden>/);
    assert.match(rewritten, /<duration>10 minutes<\/duration>/);
    assert.doesNotMatch(rewritten, /Old prose/);
});

test('mechanical result builders ask the model only for unknown prose and reasoning fields', () => {
    const proseValues = approvedProseValues();
    const craft = buildCraftResult({
        assignments: {
            otherEffectProse: 'It glows faintly.',
            timeReasoning: 'Careful assembly takes time.'
        },
        checkpointValues: proseValues,
        templateContext: {
            authoritativeTimePassedMinutes: 12,
            otherEffect: 'glowing'
        }
    });
    assert.match(craft, /<duration>12 minutes<\/duration>/);
    assert.match(craft, /<otherEffectDescription><!\[CDATA\[It glows faintly\.\]\]><\/otherEffectDescription>/);

    const modification = buildLocationModificationResult({
        assignments: { timeReasoning: 'The repair is brief.' },
        checkpointValues: proseValues,
        templateContext: {
            authoritativeTimePassedMinutes: 4,
            otherEffect: null
        }
    });
    assert.match(modification, /<otherEffectDescription>N\/A<\/otherEffectDescription>/);
    assert.match(modification, /<duration>4 minutes<\/duration>/);

    const container = buildContainerOpenResult({
        assignments: {
            permanentlyOpened: true,
            timeReasoning: 'The lock takes patience.',
            timeDuration: { text: '3 minutes', minutes: 3 }
        },
        checkpointValues: proseValues,
        toolInvocations: [{
            name: 'resolveSkillCheck',
            metadata: {
                actionResolution: {
                    success: true,
                    label: 'full success'
                }
            }
        }]
    });
    assert.match(container, /<toolUsed>resolveSkillCheck<\/toolUsed>/);
    assert.match(container, /<checkResult>full success<\/checkResult>/);
    assert.match(container, /<success>true<\/success>/);
    assert.match(container, /<permanentlyOpened>true<\/permanentlyOpened>/);
    assert.match(container, /<duration>3 minutes<\/duration>/);
});
