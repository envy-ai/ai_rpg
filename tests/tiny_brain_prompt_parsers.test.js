const test = require('node:test');
const assert = require('node:assert/strict');

const {
    parseAllowedCharacterSelection,
    parseContainerOpenNarrativeResult,
    parseCraftNarrativeResult,
    parseNarrativeScope,
    parseQuestRewardResult,
    parseRevisionDecision,
    parseScheduledEventInterruptionRewrite,
    parseScheduledEventStagedResult,
    parseWhileAwayCharacterUpdate,
    parseWhileYouWereAwayStagedResult
} = require('../TinyBrainPromptParsers.js');

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
    assert.throws(
        () => parseCraftNarrativeResult(craftXml, { expectedDurationMinutes: 10 }),
        /must exactly match "10 minutes"/
    );

    const containerXml = '<containerOpenResult><toolUsed>resolveSkillCheck</toolUsed>'
        + '<checkResult>Success</checkResult><success>true</success><permanentlyOpened>true</permanentlyOpened>'
        + '<prose>The lock clicks.</prose><timePassed><reasoning>Picking.</reasoning><duration>2 minutes</duration></timePassed>'
        + '</containerOpenResult>';
    assert.equal(parseContainerOpenNarrativeResult(containerXml, {
        expectedToolName: 'resolveSkillCheck'
    }).value, containerXml);
    assert.throws(
        () => parseContainerOpenNarrativeResult(containerXml, {
            expectedToolName: 'resolveOpposedSkillCheck'
        }),
        /must exactly match/
    );
});

test('while-away staged parser prevents final structured-state drift', () => {
    const mira = '<characterUpdate><name>Mira</name><needBarChanges/><update>She repaired the latch.</update></characterUpdate>';
    assert.equal(parseWhileAwayCharacterUpdate(mira, 'Mira').value.name, 'Mira');
    const finalXml = '<response><proseForPlayer>The repaired latch shines.</proseForPlayer><characterUpdates>'
        + mira
        + '</characterUpdates><itemSceneryMoves><itemName>Toolbox</itemName></itemSceneryMoves></response>';
    assert.equal(parseWhileYouWereAwayStagedResult(finalXml, {
        characterUpdateXml: [mira],
        arrivalUpdatesXml: '<characterUpdates/>',
        itemSceneryMovesXml: '<itemSceneryMoves><itemName>Toolbox</itemName></itemSceneryMoves>'
    }).value, finalXml);
    assert.throws(
        () => parseWhileYouWereAwayStagedResult(finalXml.replace('Toolbox', 'Crate'), {
            characterUpdateXml: [mira],
            arrivalUpdatesXml: '<characterUpdates/>',
            itemSceneryMovesXml: '<itemSceneryMoves><itemName>Toolbox</itemName></itemSceneryMoves>'
        }),
        /changed the staged item\/scenery moves/
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
