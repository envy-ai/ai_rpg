const test = require('node:test');
const assert = require('node:assert/strict');

const {
    parseAllowedCharacterSelection,
    parseContainerOpenNarrativeResult,
    parseCraftNarrativeResult,
    parseExactXmlRoot,
    parseNarrativeScope,
    parseNeedBarCharactersResult,
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
    parseScheduledEventInterruptionRewrite,
    parseScheduledEventStagedResult,
    parseWhileAwayArrivalUpdates,
    parseWhileAwayCharacterUpdate,
    parseWhileYouWereAwayStagedResult
} = require('../TinyBrainPromptParsers.js');

test('exact XML root parser permits empty roots only when explicitly enabled', () => {
    assert.equal(
        parseExactXmlRoot('<characterUpdates/>', 'characterUpdates', {
            allowEmptyRoot: true
        }).value,
        '<characterUpdates/>'
    );
    assert.equal(
        parseExactXmlRoot('<itemSceneryMoves></itemSceneryMoves>', 'itemSceneryMoves', {
            allowEmptyRoot: true
        }).value,
        '<itemSceneryMoves></itemSceneryMoves>'
    );
    assert.throws(
        () => parseExactXmlRoot('<characterUpdates/>', 'characterUpdates'),
        /cannot be empty/i
    );
    const relaxed = parseExactXmlRoot(
        'Planning complete.\n```xml\n<rewardPlan><reward>Key</reward></rewardPlan>\n```',
        'rewardPlan'
    );
    assert.equal(relaxed.value, '<rewardPlan><reward>Key</reward></rewardPlan>');
    assert.equal(relaxed.normalizedResponse, relaxed.value);
});

test('need-bar characters parser enforces the staged XML contract', () => {
    const xml = '<characters><character><name>Wanderer</name><affectedNeedBars>'
        + '<needBar><id>stamina</id><changeDirection>decrease</changeDirection>'
        + '<change>small</change><reason>swung a weapon</reason></needBar>'
        + '</affectedNeedBars></character></characters>';
    assert.equal(parseNeedBarCharactersResult(xml, ['stamina']).value, xml);
    assert.equal(
        parseNeedBarCharactersResult('<characters></characters>', ['stamina']).value,
        '<characters></characters>'
    );
    assert.throws(
        () => parseNeedBarCharactersResult(xml.replace('<id>stamina</id>', '<id>hunger</id>'), ['stamina']),
        /unknown need-bar id/i
    );
    const longReasonXml = xml.replace(
        'swung a weapon',
        'one two three four five six seven eight nine ten eleven twelve'
    );
    assert.equal(
        parseNeedBarCharactersResult(longReasonXml, ['stamina']).value,
        longReasonXml
    );
    assert.equal(
        parseNeedBarCharactersResult(`Planning:\n\`\`\`xml\n${xml}\n\`\`\``, ['stamina']).value,
        xml
    );
});

test('player-action non-XML parsers enforce compact branch-safe answers', () => {
    assert.equal(parsePlayerActionMovement('NONE', false).value, 'none');
    assert.equal(parsePlayerActionMovement('**Answer: NONE.**', false).value, 'none');
    assert.equal(parsePlayerActionMovement('disembark', true).value, 'disembark');
    assert.throws(() => parsePlayerActionMovement('DISEMBARK', false), /requires a current vehicle/i);
    assert.throws(() => parsePlayerActionMovement('I think NONE', false), /exactly one allowed/i);

    assert.equal(
        parsePlayerActionVehicleDecision('REDIRECT', 'none', true).value,
        'redirect'
    );
    assert.equal(
        parsePlayerActionVehicleDecision('STOP_FOR_EXIT', 'disembark', true).value,
        'stop_for_exit'
    );
    assert.throws(
        () => parsePlayerActionVehicleDecision('DEPART', 'none', true),
        /not valid/i
    );
    assert.throws(
        () => parsePlayerActionVehicleDecision('STOP_FOR_EXIT', 'disembark', false),
        /not valid/i
    );

    assert.deepEqual(
        parsePlayerActionProseScope('DESTINATION, ORIGIN').value,
        ['origin', 'destination']
    );
    assert.deepEqual(
        parsePlayerActionProseScope('ORIGIN; ORIGIN and DESTINATION.').value,
        ['origin', 'destination']
    );

    assert.deepEqual(
        parsePlayerActionDestination('Location: City Hall Exterior\nRegion: Johnstown').value,
        { location: 'City Hall Exterior', region: 'Johnstown' }
    );
    assert.deepEqual(
        parsePlayerActionDestination('Location: N/A\nRegion: The Far North').value,
        { location: null, region: 'The Far North' }
    );
    assert.deepEqual(
        parsePlayerActionDestination('- Region: Johnstown\n- Location: City Hall').value,
        { location: 'City Hall', region: 'Johnstown' }
    );
    assert.throws(
        () => parsePlayerActionDestination('Location: N/A\nRegion: N/A'),
        /requires a location or region/i
    );
    assert.deepEqual(
        parsePlayerActionDuration('1 hour, 30 minutes', 1).value,
        { text: '1 hour, 30 minutes', minutes: 90 }
    );
    assert.throws(() => parsePlayerActionDuration('0 minutes', 1), /at least 1 minute/i);
    assert.throws(() => parsePlayerActionDuration('About 10 minutes', 1), /invalid/i);

    assert.deepEqual(
        parsePlayerActionAccompanyingCharacters('Mira\nTal Stone', [
            { name: 'Mira Vale', aliases: ['Mira'] },
            { name: 'Tal Stone', aliases: [] }
        ]).value,
        ['Mira Vale', 'Tal Stone']
    );
    assert.deepEqual(
        parsePlayerActionAccompanyingCharacters('NONE', [{ name: 'Mira Vale', aliases: ['Mira'] }]).value,
        []
    );
    assert.deepEqual(
        parsePlayerActionAccompanyingCharacters('mira', [{ name: 'Mira Vale', aliases: ['Mira'] }]).value,
        ['Mira Vale']
    );
    assert.deepEqual(
        parsePlayerActionAccompanyingCharacters('- Mira, Tal Stone', [
            { name: 'Mira Vale', aliases: ['Mira'] },
            { name: 'Tal Stone', aliases: [] }
        ]).value,
        ['Mira Vale', 'Tal Stone']
    );
    assert.throws(
        () => parsePlayerActionAccompanyingCharacters('Mira V', [{ name: 'Mira Vale', aliases: ['Mira'] }]),
        /allowed exact character name/i
    );
    assert.throws(
        () => parsePlayerActionAccompanyingCharacters('Mira Vale\nMira', [{ name: 'Mira Vale', aliases: ['Mira'] }]),
        /duplicate/i
    );
    assert.deepEqual(
        parsePlayerActionAccompanyingCharacters('- Mira Vale', [{ name: 'Mira Vale', aliases: ['Mira'] }]).value,
        ['Mira Vale']
    );

    assert.equal(parsePlayerActionRequiredProse('A door opens.').value, 'A door opens.');
    assert.equal(parsePlayerActionHiddenNotes('N/A').value, null);
    assert.equal(parsePlayerActionHiddenNotes('The key is newly bent.').value, 'The key is newly bent.');
    assert.equal(parsePlayerActionTimeReasoning('The conversation is brief.').value, 'The conversation is brief.');
    assert.throws(
        () => parsePlayerActionRequiredProse('<turnResult><prose>No.</prose></turnResult>'),
        /must not contain/i
    );
    assert.throws(
        () => parsePlayerActionRequiredProse('Visible.<hidden>Secret.</hidden>'),
        /must not contain/i
    );
});

test('revision and allowed-character parsers reject ambiguity and duplicates', () => {
    assert.equal(
        parseNarrativeScope(
            '<narrativeScope><travel>yes</travel><before>Gate</before><during>Road</during><after>Town</after></narrativeScope>'
        ).value.travel,
        true
    );
    assert.deepEqual(
        parseRevisionDecision('<revisionDecision><revise>no</revise></revisionDecision>').value,
        {
            revise: false,
            issues: '',
            xml: '<revisionDecision><revise>no</revise></revisionDecision>'
        }
    );
    assert.throws(
        () => parseRevisionDecision('<revisionDecision><revise>yes</revise></revisionDecision>'),
        /requires non-empty <issues>/
    );
    assert.deepEqual(
        parseAllowedCharacterSelection(
            '<selectedCharacters><name>Mira</name><name>Tal</name></selectedCharacters>',
            ['Mira', 'Tal'],
            1,
            2
        ).value,
        ['Mira', 'Tal']
    );
    assert.deepEqual(
        parseOutcomeAcknowledgement(
            '<outcomeAcknowledgement><fact>produced=Key</fact><fact>degree=success</fact></outcomeAcknowledgement>',
            ['degree=success', 'produced=Key']
        ).value,
        ['produced=Key', 'degree=success']
    );
    assert.throws(
        () => parseAllowedCharacterSelection(
            '<selectedCharacters><name>Mira</name><name>Mira</name></selectedCharacters>',
            ['Mira'],
            0,
            2
        ),
        /duplicate character/
    );
});

test('domain final parsers enforce reward coverage, duration authority, and check tool identity', () => {
    const reward = parseQuestRewardResult(
        '<questRewardResult><prose>The purse and key pass to you.</prose>'
        + '<rewardCoverage><index>1</index><included>50 credits</included></rewardCoverage>'
        + '<rewardCoverage><index>2</index><included>Brass key</included></rewardCoverage>'
        + '</questRewardResult>',
        2
    );
    assert.equal(reward.value.prose, 'The purse and key pass to you.');
    assert.throws(
        () => parseQuestRewardResult(
            '<questRewardResult><prose>Only one.</prose>'
            + '<rewardCoverage><index>1</index><included>50 credits</included></rewardCoverage>'
            + '</questRewardResult>',
            2
        ),
        /exactly 2/
    );

    const craftXml = '<result><description>The key takes shape.</description>'
        + '<timePassed><reasoning>Filing and fitting.</reasoning><duration>12 minutes</duration></timePassed></result>';
    assert.equal(parseCraftNarrativeResult(craftXml, { expectedDurationMinutes: 12 }).value, craftXml);
    assert.equal(
        parseCraftNarrativeResult(
            craftXml.replace('12 minutes', '0.2 hours'),
            { expectedDurationMinutes: 12 }
        ).value,
        craftXml.replace('12 minutes', '0.2 hours')
    );
    assert.throws(
        () => parseCraftNarrativeResult(craftXml, { expectedDurationMinutes: 10 }),
        /must resolve to exactly 10 minutes/
    );

    const containerXml = '<containerOpenResult><toolUsed>resolveSkillCheck</toolUsed>'
        + '<checkResult>Success</checkResult><success>true</success><permanentlyOpened>true</permanentlyOpened>'
        + '<prose>The lock clicks.</prose><timePassed><reasoning>Picking.</reasoning><duration>2 minutes</duration></timePassed>'
        + '</containerOpenResult>';
    assert.equal(parseContainerOpenNarrativeResult(containerXml, {
        expectedToolName: 'resolveSkillCheck',
        expectedSuccess: true
    }).value, containerXml);
    assert.throws(
        () => parseContainerOpenNarrativeResult(containerXml, {
            expectedToolName: 'resolveOpposedSkillCheck'
        }),
        /must exactly match/
    );
    assert.throws(
        () => parseContainerOpenNarrativeResult(
            containerXml.replace('<checkResult>Success</checkResult>', '<checkResult>Failure</checkResult>')
                .replace('<success>true</success>', '<success>false</success>'),
            { expectedToolName: 'resolveSkillCheck', expectedSuccess: true }
        ),
        /authoritative check result/
    );
    assert.throws(
        () => parseContainerOpenNarrativeResult(
            containerXml.replace('<success>true</success>', '<success>false</success>')
        ),
        /failed container-open check cannot permanently open/
    );
    assert.throws(
        () => parseContainerOpenNarrativeResult(
            containerXml.replace(
                '<timePassed><reasoning>Picking.</reasoning><duration>2 minutes</duration></timePassed>',
                '<timePassed>anything</timePassed>'
            )
        ),
        /requires exactly one direct <duration>/
    );
});

test('while-away staged parser prevents final structured-state drift', () => {
    const mira = '<characterUpdate><name>Mira</name><needBarChanges/><update>She repaired the latch.</update></characterUpdate>';
    assert.equal(parseWhileAwayCharacterUpdate(mira, 'Mira').value.name, 'Mira');
    assert.throws(
        () => parseWhileAwayCharacterUpdate(
            '<characterUpdate><name>Mira</name><needs>Fine</needs><hiddenUpdate>She repaired the latch.</hiddenUpdate></characterUpdate>',
            'Mira'
        ),
        /unexpected direct child <needs>/
    );
    assert.throws(
        () => parseWhileAwayCharacterUpdate(
            '<characterUpdate><name>Mira</name><needBarChanges/></characterUpdate>',
            'Mira'
        ),
        /requires exactly one direct <update>/
    );
    assert.throws(
        () => parseWhileAwayCharacterUpdate(
            '<characterUpdate><name>Mira</name><needBarChanges><needBarEffect>'
            + '<needBarId>stamina</needBarId><value>potato</value>'
            + '</needBarEffect></needBarChanges><update>She rested.</update></characterUpdate>',
            'Mira'
        ),
        /percentage from 0 to 100 or N\/A/
    );
    assert.equal(
        parseWhileAwayArrivalUpdates('<characterUpdates/>').value,
        '<characterUpdates/>'
    );
    assert.throws(
        () => parseWhileAwayArrivalUpdates(
            '<characterUpdates><characterUpdate><name>Rin</name><needBarChanges/><update>She arrived.</update></characterUpdate></characterUpdates>'
        ),
        /requires <travelDestination>HERE<\/travelDestination>/
    );
    const finalXml = '<response><proseForPlayer>The repaired latch shines.</proseForPlayer><characterUpdates>'
        + mira
        + '</characterUpdates><itemSceneryMoves><itemName>Toolbox</itemName></itemSceneryMoves></response>';
    assert.equal(parseWhileYouWereAwayStagedResult(finalXml, {
        characterUpdateXml: [mira],
        arrivalUpdatesXml: '<characterUpdates/>',
        itemSceneryMovesXml: '<itemSceneryMoves><itemName>Toolbox</itemName></itemSceneryMoves>'
    }).value, finalXml);
    const reorderedMoves = '<response><proseForPlayer>Ready.</proseForPlayer><characterUpdates/>'
        + '<itemSceneryMoves><itemName>Rope</itemName><itemName>Toolbox</itemName></itemSceneryMoves></response>';
    assert.equal(parseWhileYouWereAwayStagedResult(reorderedMoves, {
        characterUpdateXml: [],
        arrivalUpdatesXml: '<characterUpdates/>',
        itemSceneryMovesXml: '<itemSceneryMoves><itemName>Toolbox</itemName><itemName>Rope</itemName></itemSceneryMoves>'
    }).value, reorderedMoves);
    assert.throws(
        () => parseWhileYouWereAwayStagedResult(finalXml.replace('Toolbox', 'Crate'), {
            characterUpdateXml: [mira],
            arrivalUpdatesXml: '<characterUpdates/>',
            itemSceneryMovesXml: '<itemSceneryMoves><itemName>Toolbox</itemName></itemSceneryMoves>'
        }),
        /changed the staged item\/scenery moves/
    );
    assert.throws(
        () => parseWhileYouWereAwayStagedResult(
            finalXml.replace('</characterUpdates>', '<characterUpdates/></characterUpdates>'),
            {
                characterUpdateXml: [mira],
                arrivalUpdatesXml: '<characterUpdates/>',
                itemSceneryMovesXml: '<itemSceneryMoves><itemName>Toolbox</itemName></itemSceneryMoves>'
            }
        ),
        /unexpected direct child <characterupdates>/
    );
});

test('scheduled-event parsers preserve approved summaries and interruption non-prose XML', () => {
    const scheduledXml = '<scheduledEventResult><summary>The bell rang.</summary><proseForPlayer>A bell rings.</proseForPlayer></scheduledEventResult>';
    assert.equal(parseScheduledEventStagedResult(scheduledXml, {
        happened: true,
        expectedSummary: 'The bell rang.',
        playerPresent: true
    }).value, scheduledXml);
    assert.throws(
        () => parseScheduledEventStagedResult(scheduledXml.replace('The bell rang.', 'Something else.'), {
            happened: true,
            expectedSummary: 'The bell rang.',
            playerPresent: true
        }),
        /exactly match/
    );

    const original = '<turnResult><prose>Work continues.</prose><hidden>keep me</hidden>'
        + '<timePassed><duration>10 minutes</duration></timePassed></turnResult>';
    const validRewrite = original.replace('Work continues.', 'A bell interrupts the work.');
    assert.equal(parseScheduledEventInterruptionRewrite(validRewrite, original).value, validRewrite);
    assert.throws(
        () => parseScheduledEventInterruptionRewrite(
            validRewrite.replace('10 minutes', '5 minutes'),
            original
        ),
        /changed a non-prose XML field/
    );
});
