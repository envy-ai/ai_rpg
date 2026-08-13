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
    parsePlayerActionVehicleDestination,
    parsePlayerActionDestinationChanges,
    parsePlayerActionExplicitDuration,
    parsePlayerActionDuration,
    parsePlayerActionAccompanyingCharacters,
    parsePlayerActionHiddenContests,
    parsePlayerActionHiddenNotes,
    parsePlayerActionMoreInfoOrNa,
    parsePlayerActionMovement,
    parsePlayerActionProseScope,
    parsePlayerActionRequiredProse,
    parsePlayerActionTimeReasoning,
    parsePlayerActionVehicleDecision,
    parseQuestRewardResult,
    parseRevisionDecision,
    parseScheduledEventApplicability,
    parseScheduledEventInterruptionRewrite,
    parseScheduledEventToolPlan,
    parseScheduledEventToolExecution,
    parseScheduledEventSummary,
    parseScheduledEventStagedResult,
    validateScheduledEventToolCallAgainstPlan,
    parseWhileAwayArrivalUpdates,
    parseWhileAwayCharacterUpdate,
    parseWhileYouWereAwayResult,
    parseWhileYouWereAwayStagedResult
} = require('../TinyBrainPromptParsers.js');

const hiddenContestContext = {
    player: {
        id: 'player_1',
        name: 'Baato',
        aliases: ['the captain'],
        isNPC: false,
        hiddenFromPlayer: false
    },
    npcs: [
        {
            id: 'npc_hidden',
            name: 'Veiled Scout',
            aliases: ['Whisper'],
            isNPC: true,
            hiddenFromPlayer: true
        },
        {
            id: 'npc_visible',
            name: 'Loud Decoy',
            aliases: ['Bell'],
            isNPC: true,
            hiddenFromPlayer: false
        }
    ]
};

test('player-action hidden-contest parser canonicalizes eligible names and aliases', () => {
    assert.deepEqual(
        parsePlayerActionHiddenContests('<hiddenContests/>', hiddenContestContext).value,
        []
    );
    assert.deepEqual(
        parsePlayerActionHiddenContests(
            '<hiddenContests><contest><action>reveal</action><actor>you</actor>'
                + '<opponent>Whisper</opponent></contest><contest><action>hide</action>'
                + '<actor>Bell</actor><opponent>the captain</opponent></contest></hiddenContests>',
            hiddenContestContext
        ).value,
        [
            {
                action: 'reveal_hidden_npc',
                actorId: 'player_1',
                actorName: 'Baato',
                opponentId: 'npc_hidden',
                opponentName: 'Veiled Scout',
                npcId: 'npc_hidden',
                npcName: 'Veiled Scout'
            },
            {
                action: 'hide_visible_npc',
                actorId: 'npc_visible',
                actorName: 'Loud Decoy',
                opponentId: 'player_1',
                opponentName: 'Baato',
                npcId: 'npc_visible',
                npcName: 'Loud Decoy'
            }
        ]
    );
});

test('player-action hidden-contest parser rejects mechanically ineligible plans', () => {
    assert.throws(
        () => parsePlayerActionHiddenContests(
            '<hiddenContests><contest><action>reveal</action><actor>Baato</actor>'
                + '<opponent>Loud Decoy</opponent></contest></hiddenContests>',
            hiddenContestContext
        ),
        /currently hidden local NPC/i
    );
    assert.throws(
        () => parsePlayerActionHiddenContests(
            '<hiddenContests><contest><action>hide</action><actor>Whisper</actor>'
                + '<opponent>Baato</opponent></contest></hiddenContests>',
            hiddenContestContext
        ),
        /currently visible local NPC/i
    );
    assert.throws(
        () => parsePlayerActionHiddenContests(
            '<hiddenContests><contest><action>hide</action><actor>Bell</actor>'
                + '<opponent>Whisper</opponent></contest></hiddenContests>',
            hiddenContestContext
        ),
        /opponent must be the current player/i
    );
    assert.throws(
        () => parsePlayerActionHiddenContests(
            '<hiddenContests><contest><action>hide</action><actor>Bell</actor>'
                + '<opponent>Baato</opponent><reason>because</reason></contest></hiddenContests>',
            hiddenContestContext
        ),
        /unexpected direct child <reason>/i
    );
});

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
    assert.throws(
        () => parseNeedBarCharactersResult(
            xml.replace('</characters>', `${xml.slice('<characters>'.length, -'</characters>'.length)}</characters>`),
            ['stamina']
        ),
        /duplicate character/i
    );
    const duplicateBarXml = xml.replace(
        '</affectedNeedBars>',
        '<needBar><id>STAMINA</id><changeDirection>decrease</changeDirection>'
            + '<change>medium</change><reason>kept swinging</reason></needBar></affectedNeedBars>'
    );
    assert.throws(
        () => parseNeedBarCharactersResult(duplicateBarXml, ['stamina']),
        /duplicate need bar/i
    );
    assert.throws(
        () => parseNeedBarCharactersResult(
            xml.replace('<changeDirection>decrease</changeDirection>', '<changeDirection>lower</changeDirection>'),
            ['stamina']
        ),
        /changeDirection.*increase or decrease/i
    );
    assert.throws(
        () => parseNeedBarCharactersResult(
            xml.replace('<change>small</change>', '<change>slightly</change>'),
            ['stamina']
        ),
        /<change>.*small, medium, large/i
    );
    assert.throws(
        () => parseNeedBarCharactersResult(
            '<characters><commentary>Wanderer used stamina.</commentary></characters>',
            ['stamina']
        ),
        /unexpected(?: direct child)? <commentary>/i
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

    const fillAliasXml = xml
        .replace('<changeDirection>decrease</changeDirection>', '<changeDirection>increase</changeDirection>')
        .replace('<change>small</change>', '<change>fill</change>');
    assert.equal(
        parseNeedBarCharactersResult(fillAliasXml, ['stamina']).value,
        fillAliasXml.replace('<change>fill</change>', '<change>full</change>')
    );
    const drainAliasXml = xml.replace('<change>small</change>', '<change>drain</change>');
    assert.equal(
        parseNeedBarCharactersResult(drainAliasXml, ['stamina']).value,
        drainAliasXml.replace('<change>drain</change>', '<change>empty</change>')
    );
    assert.throws(
        () => parseNeedBarCharactersResult(
            xml.replace('<change>small</change>', '<change>full</change>'),
            ['stamina']
        ),
        /requires <changeDirection>increase/i
    );
    assert.throws(
        () => parseNeedBarCharactersResult(
            fillAliasXml.replace('<changeDirection>increase</changeDirection>', '<changeDirection>decrease</changeDirection>'),
            ['stamina']
        ),
        /requires <changeDirection>increase/i
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
    const fixedRouteVehicle = {
        name: 'QA Clockwork Tram',
        vehicleInfo: {
            destinations: ['loc_west', 'loc_east', 'pending-region:North Reach']
        },
        allowedDestinations: [
            {
                kind: 'location',
                routeEntry: 'loc_west',
                locationId: 'loc_west',
                locationName: 'QA West Platform',
                regionName: 'Ember Hollow'
            },
            {
                kind: 'location',
                routeEntry: 'loc_east',
                locationId: 'loc_east',
                locationName: 'QA East Platform',
                regionName: 'Ember Hollow'
            },
            {
                kind: 'region',
                routeEntry: 'pending-region:North Reach',
                locationId: null,
                locationName: null,
                regionName: 'North Reach'
            }
        ]
    };
    assert.deepEqual(
        parsePlayerActionVehicleDestination(
            'Location: qa east platform\nRegion: ember hollow',
            fixedRouteVehicle
        ).value,
        { location: 'QA East Platform', region: 'Ember Hollow' }
    );
    assert.deepEqual(
        parsePlayerActionVehicleDestination(
            'Location: North Gate\nRegion: north reach',
            fixedRouteVehicle
        ).value,
        { location: 'North Gate', region: 'North Reach' }
    );
    assert.throws(
        () => parsePlayerActionVehicleDestination(
            'Location: Ember Hollow Village Square\nRegion: Ember Hollow',
            fixedRouteVehicle
        ),
        /not in its allowed route.*QA West Platform.*QA East Platform/is
    );
    const vehicleDestinationRetryState = {};
    assert.throws(
        () => parsePlayerActionVehicleDestination(
            'Location: Ember Hollow Village Square\nRegion: Ember Hollow',
            fixedRouteVehicle,
            { retryState: vehicleDestinationRetryState }
        ),
        /not in its allowed route.*QA West Platform.*QA East Platform/is
    );
    assert.throws(
        () => parsePlayerActionVehicleDestination(
            'Location: QA West Platform\nRegion: Ember Hollow',
            fixedRouteVehicle,
            { retryState: vehicleDestinationRetryState }
        ),
        /may not replace the initially extracted destination.*Ember Hollow Village Square.*QA West Platform/is
    );
    assert.throws(
        () => parsePlayerActionVehicleDestination(
            'Location: QA East Platform\nRegion: Ember Hollow',
            {
                name: 'Broken Tram',
                vehicleInfo: { destinations: ['loc_east'] }
            }
        ),
        /must provide every canonical allowed destination/i
    );
    assert.deepEqual(
        parsePlayerActionDuration('1 hour, 30 minutes', 1).value,
        { text: '1 hour, 30 minutes', minutes: 90 }
    );
    assert.deepEqual(
        parsePlayerActionExplicitDuration('5 minutes'),
        {
            value: { text: '5 minutes', minutes: 5 },
            normalizedResponse: '5 minutes'
        }
    );
    assert.deepEqual(
        parsePlayerActionExplicitDuration('NONE'),
        { value: null, normalizedResponse: 'NONE' }
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
    assert.equal(parsePlayerActionRequiredProse('One count is less than < two.').value, 'One count is less than < two.');
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
    assert.throws(
        () => parsePlayerActionRequiredProse('<scheduledEventResult><proseForPlayer>No.</proseForPlayer></scheduledEventResult>'),
        /prose only, without XML markup/i
    );
    assert.throws(
        () => parsePlayerActionRequiredProse('<story>No wrapper is allowed.</story>'),
        /prose only, without XML markup/i
    );
});

test('player-action destination lookup requires N/A or a successful moreInfo call followed by READY', () => {
    assert.equal(parsePlayerActionMoreInfoOrNa('N/A').value, false);
    assert.equal(parsePlayerActionMoreInfoOrNa('**Answer: N/A.**').value, false);
    assert.equal(parsePlayerActionMoreInfoOrNa('N/A. There is no useful lookup to make.').normalizedResponse, 'N/A');
    assert.equal(
        parsePlayerActionMoreInfoOrNa('READY — the lookup result has what I need.', {
            currentToolInvocations: [{
                id: 'lookup-1',
                name: 'moreInfo',
                metadata: { totalMatches: 1 }
            }]
        }).value,
        true
    );

    assert.throws(
        () => parsePlayerActionMoreInfoOrNa('Baato walks into the square.'),
        /must begin with N\/A/i
    );
    assert.throws(
        () => parsePlayerActionMoreInfoOrNa('READY'),
        /without a successful moreInfo call/i
    );
    assert.throws(
        () => parsePlayerActionMoreInfoOrNa('N/A', {
            currentToolInvocations: [{ name: 'moreInfo', metadata: { totalMatches: 0 } }]
        }),
        /must answer READY/i
    );
    assert.throws(
        () => parsePlayerActionMoreInfoOrNa('READY', {
            currentToolInvocations: [{ name: 'moreInfo', metadata: { error: true } }]
        }),
        /execution failed/i
    );
    assert.throws(
        () => parsePlayerActionMoreInfoOrNa('READY', {
            currentToolInvocations: [{ name: 'getHistory', metadata: {} }]
        }),
        /may only call moreInfo/i
    );
});

test('player-action destination changes parser accepts only NONE or Markdown bullets', () => {
    assert.deepEqual(parsePlayerActionDestinationChanges('NONE').value, []);
    assert.deepEqual(parsePlayerActionDestinationChanges('N/A').value, []);
    assert.deepEqual(
        parsePlayerActionDestinationChanges('- The fountain is under repair.\n- Mira opened a flower stall.').value,
        ['The fountain is under repair.', 'Mira opened a flower stall.']
    );
    assert.throws(
        () => parsePlayerActionDestinationChanges('Changes:\n- The fountain is under repair.'),
        /Markdown bullet list/i
    );
    assert.throws(
        () => parsePlayerActionDestinationChanges('1. The fountain is under repair.'),
        /Markdown bullet list/i
    );
    assert.throws(
        () => parsePlayerActionDestinationChanges('- Same change\n- same   change'),
        /duplicate bullet/i
    );
    assert.throws(
        () => parsePlayerActionDestinationChanges('- NONE'),
        /cannot mix/i
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
    const rinArrival = '<characterUpdate><name>Rin</name><needBarChanges/>'
        + '<travelDestination>HERE</travelDestination><update>She arrived.</update></characterUpdate>';
    const finalWithArrival = '<response><proseForPlayer>Rin is waiting here.</proseForPlayer><characterUpdates>'
        + rinArrival
        + '</characterUpdates><itemSceneryMoves/></response>';
    assert.equal(parseWhileYouWereAwayResult(finalWithArrival).value, finalWithArrival);
    assert.equal(parseWhileYouWereAwayStagedResult(finalWithArrival, {
        characterUpdateXml: [],
        arrivalUpdatesXml: `<characterUpdates>${rinArrival}</characterUpdates>`,
        itemSceneryMovesXml: '<itemSceneryMoves/>'
    }).value, finalWithArrival);
    assert.throws(
        () => parseWhileYouWereAwayResult(finalWithArrival.replace('>HERE<', '>nearby<')),
        /location.*region.*HERE sentinel/i
    );
    assert.throws(
        () => parseWhileYouWereAwayResult(
            finalWithArrival.replace(
                '>HERE<',
                '>HERE<location>Town Square</location><'
            )
        ),
        /must not mix text/i
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
    assert.equal(
        parseScheduledEventApplicability(
            '<applicability><decision>yes</decision><reason>The bell remains due.</reason></applicability>'
        ).value,
        true
    );
    assert.equal(
        parseScheduledEventApplicability(
            '<applicability><decision>no</decision><reason>The bell was removed.</reason></applicability>'
        ).value,
        false
    );
    assert.throws(
        () => parseScheduledEventApplicability(
            '<applicability><decision>maybe</decision><reason>Unclear.</reason></applicability>'
        ),
        /exactly yes or no/i
    );
    assert.throws(
        () => parseScheduledEventApplicability(
            '<applicability><decision>yes</decision><reason>Due.</reason><decision>no</decision></applicability>'
        ),
        /exactly one direct <decision>/i
    );
    assert.equal(
        parseScheduledEventSummary('<summary>The bell rang once.</summary>').value,
        'The bell rang once.'
    );
    assert.throws(
        () => parseScheduledEventSummary('<summary>N/A</summary>'),
        /null sentinel/i
    );
    assert.throws(
        () => parseScheduledEventSummary('<summary><detail>The bell rang.</detail></summary>'),
        /text only/i
    );
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
    assert.equal(parseScheduledEventStagedResult('<scheduledEventResult/>', {
        happened: false,
        playerPresent: true
    }).value, '<scheduledEventResult/>');
    assert.throws(
        () => parseScheduledEventStagedResult(
            '<scheduledEventResult><summary>The bell somehow rang.</summary></scheduledEventResult>',
            { happened: false, playerPresent: true }
        ),
        /skipped staged scheduled event must return an empty/i
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

test('scheduled-event tool plan and execution parsers enforce exact direct-update contracts', () => {
    const event = 'Change QA Depot Marker description to exactly: The depot marker bears one fresh blue QA stripe.';
    const planXml = '<toolPlan>'
        + '<directUpdates><update>'
        + '<objectType>thing</objectType><object>thing_348</object>'
        + '<field>description</field>'
        + '<valueJson>"The depot marker bears one fresh blue QA stripe."</valueJson>'
        + '</update></directUpdates><otherTools/>'
        + '</toolPlan>';
    const plan = parseScheduledEventToolPlan(
        planXml,
        event,
        ['updateObjectFields', 'alterThing']
    ).value;
    assert.equal(plan.stateChangeRequired, true);
    assert.equal(plan.directUpdates[0].object, 'thing_348');
    assert.equal(plan.directUpdates[0].field, 'description');
    assert.throws(
        () => parseScheduledEventToolPlan(
            planXml.replace('<directUpdates>', '<stateChangeRequired>yes</stateChangeRequired><directUpdates>'),
            event,
            ['updateObjectFields']
        ),
        /unexpected direct child <statechangerequired>/i
    );

    const readOnlyLookupPlan = planXml.replace(
        '<otherTools/>',
        '<otherTools><tool><name>locateThings</name>'
        + '<argumentsJson>{"query":"QA Depot Marker"}</argumentsJson>'
        + '</tool></otherTools>'
    );
    const planWithLookup = parseScheduledEventToolPlan(
        readOnlyLookupPlan,
        event,
        ['updateObjectFields', 'locateThings']
    ).value;
    assert.equal(planWithLookup.otherTools[0].name, 'locateThings');
    assert.throws(
        () => parseScheduledEventToolPlan(
            readOnlyLookupPlan.replace('</tool>', '<purpose>Redundant prose.</purpose></tool>'),
            event,
            ['updateObjectFields', 'locateThings']
        ),
        /unexpected direct child <purpose>/i
    );

    const invalidChatLogEditPlan = planXml.replace(
        '<otherTools/>',
        '<otherTools><tool><name>editChatLogEntry</name>'
        + '<argumentsJson>{"content":"Add a ledger line.","reason":"Scheduled event."}</argumentsJson>'
        + '</tool></otherTools>'
    );
    assert.throws(
        () => parseScheduledEventToolPlan(
            invalidChatLogEditPlan,
            event,
            ['updateObjectFields', 'editChatLogEntry']
        ),
        /editChatLogEntry requires either a non-empty string "entry" or a zero-based non-negative integer "index"/
    );
    const validChatLogEditPlan = parseScheduledEventToolPlan(
        invalidChatLogEditPlan.replace(
            '{"content":"Add a ledger line.","reason":"Scheduled event."}',
            '{"index":0,"content":"Add a ledger line.","reason":"Scheduled event."}'
        ),
        event,
        ['updateObjectFields', 'editChatLogEntry']
    ).value;
    assert.equal(validChatLogEditPlan.otherTools[0].argumentsObject.index, 0);

    const wrongFieldPlan = planXml.replace(
        '<field>description</field>',
        '<field>unknownField</field>'
    );
    assert.throws(
        () => parseScheduledEventToolPlan(
            wrongFieldPlan,
            event,
            ['updateObjectFields', 'alterThing']
        ),
        /unsupported thing field "unknownField"/i
    );

    const duplicatePlan = parseScheduledEventToolPlan(
        planXml.replace('</directUpdates>', planXml.match(/<update>[\s\S]*?<\/update>/)[0] + '</directUpdates>'),
        event,
        ['updateObjectFields']
    ).value;
    assert.equal(duplicatePlan.directUpdates.length, 1);

    assert.throws(
        () => parseScheduledEventToolExecution('Claimed completion.', event, plan, {
            currentToolInvocations: []
        }),
        /requires at least one successful planned tool call/i
    );

    const wrongFieldCall = {
        name: 'updateObjectFields',
        argumentsObject: {
            objectType: 'thing',
            object: 'thing_348',
            fields: {
                shortDescription: 'The depot marker bears one fresh blue QA stripe.'
            }
        }
    };
    assert.throws(
        () => validateScheduledEventToolCallAgainstPlan(wrongFieldCall, plan),
        /not an exact match for the accepted tool plan/i
    );

    const wrongValueCall = {
        name: 'updateObjectFields',
        argumentsObject: {
            objectType: 'thing',
            object: 'thing_348',
            fields: {
                description: 'The depot marker bears one fresh blue stripe.'
            }
        }
    };
    assert.throws(
        () => validateScheduledEventToolCallAgainstPlan(wrongValueCall, plan),
        /not an exact match for the accepted tool plan/i
    );

    const completedInvocation = {
        name: 'updateObjectFields',
        argumentsObject: {
            objectType: 'thing',
            object: 'thing_348',
            fields: {
                description: 'The depot marker bears one fresh blue QA stripe.'
            }
        },
        metadata: {
            status: 'success',
            objectType: 'thing',
            objectId: 'thing_348',
            objectName: 'QA Depot Marker',
            updatedValues: {
                description: 'The depot marker bears one fresh blue QA stripe.'
            }
        }
    };
    assert.equal(
        validateScheduledEventToolCallAgainstPlan(completedInvocation, plan),
        true
    );
    assert.equal(
        parseScheduledEventToolExecution('Updated the marker.', event, plan, {
            currentToolInvocations: [completedInvocation]
        }).value,
        'Updated the marker.'
    );

    const noChangeEvent = 'QA Bell Runner rings QA Brass Bell exactly once; nobody and nothing moves.';
    const noChangePlanXml = '<toolPlan><directUpdates/><otherTools/></toolPlan>';
    const noChangePlan = parseScheduledEventToolPlan(
        noChangePlanXml,
        noChangeEvent,
        ['updateObjectFields']
    ).value;
    assert.equal(noChangePlan.stateChangeRequired, false);
    assert.equal(
        parseScheduledEventToolExecution('No persistent update was needed.', noChangeEvent, noChangePlan, {
            currentToolInvocations: []
        }).value,
        'No persistent update was needed.'
    );
});
