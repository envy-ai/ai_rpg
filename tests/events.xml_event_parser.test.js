const test = require('node:test');
const assert = require('node:assert/strict');

const Events = require('../Events.js');
const Globals = require('../Globals.js');
const LLMClient = require('../LLMClient.js');
const IdGenerator = require('../IdGenerator.js');
const MysteryBox = require('../MysteryBox.js');
const MysteryThread = require('../MysteryThread.js');

test('XML event parser aggregates repeated tags through legacy parser shapes', () => {
    const parsed = Events._parseXmlEventCheckResponse(`
\`\`\`xml
<events>
  <currency><amount>5</amount></currency>
  <currency><amount>-2</amount></currency>
  <itemAppear>
    <fullItemName>Iron Key</fullItemName>
    <quantity>1</quantity>
    <description>A small iron key.</description>
  </itemAppear>
  <itemAppear>
    <fullItemName>Red Apple</fullItemName>
    <quantity>3</quantity>
    <description>Glossy fruit.</description>
  </itemAppear>
  <needBarChange>
    <characterName>Wanderer</characterName>
    <needBarId>stamina</needBarId>
    <direction>decrease</direction>
    <magnitude>small</magnitude>
    <reason>sprinted</reason>
  </needBarChange>
</events>
\`\`\`
`);

    assert.equal(parsed.structured.parsed.currency, 3);
    assert.deepEqual(parsed.structured.parsed.item_appear, [
        { name: 'Iron Key', quantity: 1, description: 'A small iron key.' },
        { name: 'Red Apple', quantity: 3, description: 'Glossy fruit.' }
    ]);
    assert.deepEqual(parsed.structured.parsed.needbar_change, [
        {
            character: 'Wanderer',
            bar: 'stamina',
            direction: 'decrease',
            magnitude: 'small',
            reason: 'sprinted'
        }
    ]);
    assert.equal(parsed.structured.rawEntries.currency, '5 | -2');
});

test('XML event parser converts core camelCase tags to existing event keys', () => {
    const previousConfig = Globals.config;
    Globals.config = {
        ...(previousConfig || {}),
        quests: { enabled: true }
    };
    try {
        const parsed = Events._parseXmlEventCheckResponse(`
<events>
  <newExitDiscovered><destination><locationName>Hidden Garden</locationName><regionName>Hedge Maze</regionName></destination><destinationType>location</destinationType><vehicleType>none</vehicleType><description>A concealed garden path.</description><origin><locationName>Old Gatehouse</locationName><regionName>Castle Grounds</regionName></origin><travelTime>5 minutes</travelTime></newExitDiscovered>
  <alterLocation><currentLocationName>Hall</currentLocationName><newLocationName>Burned Hall</newLocationName><changeDescription>Smoke blackens the walls.</changeDescription></alterLocation>
  <itemInflict><fullItemName>Healing Salve</fullItemName><targetName>Wanderer</targetName><statusEffect>Soothed</statusEffect></itemInflict>
  <itemIngest><fullItemName>Bitter Tea</fullItemName><consumerName>Wanderer</consumerName></itemIngest>
  <itemToNpc><sourceThingName>Clockwork Statue</sourceThingName><npcName>Clockwork Sentinel</npcName><description>The statue wakes.</description></itemToNpc>
  <alterItem><originalItemName>Broken Wand</originalItemName><quantity>all</quantity><newItemName>Repaired Wand</newItemName><changeDescription>The wand is mended.</changeDescription></alterItem>
  <consumeItem><fullItemName>Coal</fullItemName><quantity>2</quantity><reason>Burned as fuel</reason></consumeItem>
  <transferItem><giverName>Ada</giverName><fullItemName>Map</fullItemName><quantity>1</quantity><receiverName>Wanderer</receiverName></transferItem>
  <pickUpItem><actorName>player</actorName><fullItemName>Gem</fullItemName><quantity>1</quantity></pickUpItem>
  <harvestGather><harvesterName>Wanderer</harvesterName><fullItemName>Berries</fullItemName><quantity>4</quantity><sourceName>Berry Bush</sourceName></harvestGather>
  <dropItem><actorName>Wanderer</actorName><fullItemName>Torch</fullItemName><quantity>1</quantity></dropItem>
  <sceneryAppear><sceneryName>Stone Bench</sceneryName><description>A cold bench.</description></sceneryAppear>
  <harvestableResourceAppear><resourceName>Silver Vein</resourceName><description>A glittering vein.</description></harvestableResourceAppear>
  <attackDamage><attackerName>Goblin</attackerName><targetName>Wanderer</targetName></attackDamage>
  <alterNpc><npcName>Goblin</npcName><alterationCategory>physical transformation</alterationCategory><changeDescription>The goblin turns to stone.</changeDescription></alterNpc>
  <statusEffectChange><entityName>Wanderer</entityName><statusEffectName>Poisoned</statusEffectName><action>gained</action><level>2</level></statusEffectChange>
  <revealHiddenNpc><npcName>Shade</npcName><description>The lantern catches his sleeve.</description><useOpposedCheck>true</useOpposedCheck></revealHiddenNpc>
  <hideVisibleNpc><npcName>Ada</npcName><description>Ada melts into the crowd.</description></hideVisibleNpc>
  <npcArrival><npcName>Ada</npcName><hideFromPlayer>true</hideFromPlayer></npcArrival>
  <npcDeparture><npcName>Bram</npcName><destinationRegion>Town</destinationRegion><destinationLocation>Market</destinationLocation><hideFromPlayer>true</hideFromPlayer></npcDeparture>
  <thingArrival><thingName>Supply Wagon</thingName></thingArrival>
  <thingDeparture><thingName>Signal Beacon</thingName><destinationRegion>Town</destinationRegion><destinationLocation>Watchtower</destinationLocation></thingDeparture>
  <thingMoveWithCharacter><thingName>Handcart</thingName><characterName>Wanderer</characterName></thingMoveWithCharacter>
  <npcFirstAppearance><npcName>Mysterious Cat</npcName></npcFirstAppearance>
  <mysteryBoxMention><name>Captain Ellison</name><context>Siggy's recovered protocol phrase points to Ellison's hidden plan.</context></mysteryBoxMention>
  <partyChange><npcName>Ada</npcName><action>joined</action></partyChange>
  <tradeAvailability><npcName>Ada</npcName><willingToTrade>false</willingToTrade><reason>The offer insulted her.</reason></tradeAvailability>
  <environmentalStatusDamage><actorName>Wanderer</actorName><effect>damage</effect><severity>medium</severity><reason>Smoke inhalation.</reason></environmentalStatusDamage>
  <healRecover><characterName>Wanderer</characterName><magnitude>small</magnitude><reason>Bandaged wounds</reason></healRecover>
  <hostileToFriendly><npcName>Guard</npcName><previousDisposition>hostile</previousDisposition><newDisposition>neutral</newDisposition><reason>Accepted apology.</reason></hostileToFriendly>
  <deathIncapacitation><actorName>Goblin</actorName><outcome>incapacitated</outcome></deathIncapacitation>
  <inCombat><value>true</value></inCombat>
  <anyQuestObjectivesCompleted><value>true</value></anyQuestObjectivesCompleted>
  <receivedQuest><giverName>Ada</giverName><summary>Find the missing key.</summary></receivedQuest>
  <completedQuestObjective><questIndex>2</questIndex><objectiveIndex>3</objectiveIndex><statusReason>The key was found.</statusReason></completedQuestObjective>
  <defeatedEnemy><enemyName>Goblin</enemyName></defeatedEnemy>
  <experienceCheck><amount>25</amount><reason>Solved the lock puzzle.</reason></experienceCheck>
  <factionReputationChange><factionName>Town Guard</factionName><direction>increase</direction><magnitude>a little</magnitude><reason>Helped the guard.</reason></factionReputationChange>
  <dispositionCheck><npcName>Ada</npcName><before>wary</before><after>friendly</after><reason>Protected her.</reason></dispositionCheck>
  <timePassed><reasoning>Searching the room.</reasoning><duration>10 minutes</duration></timePassed>
  <triggeredAbility><characterName>Wanderer</characterName><abilityName>Second Wind</abilityName></triggeredAbility>
</events>
`);

        const events = parsed.structured.parsed;
        assert.equal(events.new_exit_discovered[0].name, 'Hidden Garden');
        assert.equal(events.new_exit_discovered[0].destinationLocationName, 'Hidden Garden');
        assert.equal(events.new_exit_discovered[0].destinationRegionName, 'Hedge Maze');
        assert.equal(events.new_exit_discovered[0].exitLocationName, 'Old Gatehouse');
        assert.equal(events.new_exit_discovered[0].exitRegionName, 'Castle Grounds');
        assert.equal(events.new_exit_discovered[0].travelTimeMinutes, 5);
        assert.equal(events.alter_location[0].newName, 'Burned Hall');
        assert.equal(events.item_inflict[0].item, 'Healing Salve');
        assert.equal(events.item_ingest[0].target, 'Wanderer');
        assert.equal(events.item_to_npc[0].npc, 'Clockwork Sentinel');
        assert.equal(events.alter_item[0].quantity, 'all');
        assert.equal(events.consume_item[0].quantity, 2);
        assert.equal(events.transfer_item[0].receiver, 'Wanderer');
        assert.equal(events.pick_up_item[0].item, 'Gem');
        assert.equal(events.harvest_gather[0].source, 'Berry Bush');
        assert.equal(events.drop_item[0].item, 'Torch');
        assert.deepEqual(events.scenery_appear, ['Stone Bench']);
        assert.deepEqual(events.harvestable_resource_appear, ['Silver Vein']);
        assert.deepEqual(events.attack_damage[0], { attacker: 'Goblin', target: 'Wanderer' });
        assert.equal(events.alter_npc[0].name, 'Goblin');
        assert.equal(events.status_effect_change[0].level, 2);
        assert.deepEqual(events.npc_arrival_departure, [
            { name: 'Ada', action: 'arrived', destination: null, destinationRegion: null, destinationLocation: null, hideFromPlayer: true },
            { name: 'Bram', action: 'left', destination: 'Market', destinationRegion: 'Town', destinationLocation: 'Market', hideFromPlayer: true }
        ]);
        assert.deepEqual(events.reveal_hidden_npc, [
            {
                name: 'Shade',
                description: 'The lantern catches his sleeve.',
                useOpposedCheck: true
            }
        ]);
        assert.deepEqual(events.hide_visible_npc, [
            {
                name: 'Ada',
                description: 'Ada melts into the crowd.'
            }
        ]);
        assert.deepEqual(events.thing_arrival_departure, [
            { name: 'Supply Wagon', action: 'arrived', destination: null, destinationRegion: null, destinationLocation: null },
            { name: 'Signal Beacon', action: 'left', destination: 'Watchtower', destinationRegion: 'Town', destinationLocation: 'Watchtower' }
        ]);
        assert.deepEqual(events.thing_move_with_character, [
            { thingName: 'Handcart', characterName: 'Wanderer' }
        ]);
        assert.deepEqual(events.mystery_box_mention, [
            {
                name: 'Captain Ellison',
                context: "Siggy's recovered protocol phrase points to Ellison's hidden plan."
            }
        ]);
        assert.deepEqual(events.party_change[0], { name: 'Ada', action: 'joined' });
        assert.deepEqual(events.trade_availability[0], {
            name: 'Ada',
            willingToTrade: false,
            reason: 'The offer insulted her.'
        });
        assert.equal(events.environmental_status_damage[0].effect, 'damage');
        assert.equal(events.heal_recover[0].character, 'Wanderer');
        assert.equal(events.hostile_to_friendly[0].newDisposition, 'neutral');
        assert.equal(events.death_incapacitation[0].status, 'incapacitated');
        assert.equal(events.in_combat, true);
        assert.equal(events.any_quest_objectives_completed, true);
        assert.equal(events.received_quest[0].summary, 'Find the missing key.');
        assert.deepEqual(events.completed_quest_objective[0], {
            questIndex: 2,
            objectiveIndex: 3,
            statusReason: 'The key was found.'
        });
        assert.deepEqual(events.defeated_enemy, ['Goblin']);
        assert.equal(events.experience_check[0].amount, 25);
        assert.equal(events.faction_reputation_change[0].rawFaction, 'Town Guard');
        assert.equal(events.disposition_check[0].npcName, 'Ada');
        assert.equal(events.time_passed, 10);
        assert.deepEqual(events.triggered_abilities, ['Wanderer → Second Wind']);
    } finally {
        Globals.config = previousConfig;
    }
});

test('event-check NPC updates expose canonical actor names from sanitized tracking sets', () => {
    const previousDeps = Events._deps;

    const scout = {
        id: 'npc-scout',
        name: 'QA Veiled Scout'
    };
    const courier = {
        id: 'npc-courier',
        name: 'QA Snow Courier'
    };

    try {
        Events.initialize({
            findActorByName: (name) => {
                const normalized = String(name || '').trim().toLowerCase();
                if (normalized === 'qa veiled scout') return scout;
                if (normalized === 'qa snow courier') return courier;
                return null;
            }
        });
        Events._resetTrackingSets();
        Events.newCharacters.add('QA Snow Courier');
        Events.departedCharacters.add('QA Veiled Scout');

        const state = Events._buildEventCheckNpcUpdateState(null);

        assert.deepEqual(state.addedCharacters, ['QA Snow Courier']);
        assert.deepEqual(state.departedCharacters, ['QA Veiled Scout']);
    } finally {
        Events._resetTrackingSets();
        Events._deps = previousDeps;
    }
});

test('XML event parser strictly parses and aggregates anyQuestObjectivesCompleted', () => {
    const parsed = Events._parseXmlEventCheckResponse(`
<events>
  <anyQuestObjectivesCompleted><value>false</value></anyQuestObjectivesCompleted>
  <anyQuestObjectivesCompleted><value>true</value></anyQuestObjectivesCompleted>
</events>
`);

    assert.equal(parsed.structured.parsed.any_quest_objectives_completed, true);
    assert.equal(
        Events.eventResultIndicatesAnyQuestObjectivesCompleted({ structured: parsed.structured }),
        true
    );
    assert.equal(
        Events.eventResultIndicatesAnyQuestObjectivesCompleted({
            structured: { parsed: { any_quest_objectives_completed: [false, true] } }
        }),
        true
    );

    assert.throws(
        () => Events._parseXmlEventCheckResponse(`
<events>
  <anyQuestObjectivesCompleted><value>maybe</value></anyQuestObjectivesCompleted>
</events>
`),
        /anyQuestObjectivesCompleted\.value must be exactly true or false/
    );
});

test('XML newExitDiscovered preserves destination location when destination kind is region', () => {
    const parsed = Events._parseXmlEventCheckResponse(`
<events>
  <newExitDiscovered>
    <destination>
      <locationName>Gorge Trailhead</locationName>
      <regionName>Copperwheel Gorge</regionName>
    </destination>
    <destinationType>region</destinationType>
    <vehicleType>none</vehicleType>
    <description>A switchback trail leads down into the copper gorge.</description>
    <origin>
      <locationName>Old Gatehouse</locationName>
      <regionName>Castle Grounds</regionName>
    </origin>
    <travelTime>12 minutes</travelTime>
  </newExitDiscovered>
</events>
`);

    const entry = parsed.structured.parsed.new_exit_discovered[0];
    assert.equal(entry.name, 'Copperwheel Gorge');
    assert.equal(entry.kind, 'region');
    assert.equal(entry.destinationLocationName, 'Gorge Trailhead');
    assert.equal(entry.destinationRegionName, 'Copperwheel Gorge');
    assert.equal(entry.exitLocationName, 'Old Gatehouse');
    assert.equal(entry.exitRegionName, 'Castle Grounds');
    assert.equal(entry.travelTimeMinutes, 12);
});

test('XML newExitDiscovered promoted from location uses location name as region target', () => {
    const parsed = Events._parseXmlEventCheckResponse(`
<events>
  <newExitDiscovered>
    <destination>
      <regionName>Pre-Construction Extended Network</regionName>
      <locationName>Residential Grid Alpha Access</locationName>
    </destination>
    <destinationType>location</destinationType>
    <destinationHasNewExits>true</destinationHasNewExits>
    <vehicleType>none</vehicleType>
    <description>Northbound transit corridor leading to Residential Grid Alpha.</description>
    <origin>
      <regionName>Pre-Construction Extended Network</regionName>
      <locationName>Transit Gallery</locationName>
    </origin>
    <travelTime>30 minutes</travelTime>
  </newExitDiscovered>
</events>
`);

    const entry = parsed.structured.parsed.new_exit_discovered[0];
    assert.equal(entry.name, 'Residential Grid Alpha Access');
    assert.equal(entry.kind, 'region');
    assert.equal(entry.destinationLocationName, undefined);
    assert.equal(entry.destinationRegionName, 'Residential Grid Alpha Access');
    assert.equal(entry.exitLocationName, 'Transit Gallery');
    assert.equal(entry.exitRegionName, 'Pre-Construction Extended Network');
    assert.equal(entry.travelTimeMinutes, 30);
});

test('XML event parser splits travel phases and ignores during-travel events', () => {
    const parsed = Events._parseXmlEventCheckResponse(`
<events>
  <currency><amount>5</amount></currency>
  <moveLocation><destinationName>North Gate</destinationName></moveLocation>
  <itemAppear><fullItemName>Road Dust</fullItemName><quantity>1</quantity><description>Dust kicked up during travel.</description></itemAppear>
  <arriveAtLocation/>
  <sceneryAppear><sceneryName>Gatehouse</sceneryName><description>A guarded entry.</description></sceneryAppear>
</events>
`);

    assert.equal(parsed.hasTravelBoundary, true);
    assert.deepEqual(parsed.beforeTravel.structured.parsed.currency, 5);
    assert.deepEqual(parsed.travelMove.structured.parsed.move_location, ['North Gate']);
    assert.deepEqual(parsed.afterTravel.structured.parsed.scenery_appear, ['Gatehouse']);
    assert.deepEqual(parsed.ignoredDuringEvents.map(entry => entry.tagName), ['itemAppear']);
    assert.equal(parsed.structured.parsed.item_appear, undefined);
});

test('XML event parser applies in-transit thing moves after travel arrival', () => {
    const parsed = Events._parseXmlEventCheckResponse(`
<events>
  <moveLocation><destinationName>North Gate</destinationName></moveLocation>
  <thingMoveWithCharacter><thingName>Handcart</thingName><characterName>player</characterName></thingMoveWithCharacter>
  <arriveAtLocation/>
</events>
`);

    assert.equal(parsed.hasTravelBoundary, true);
    assert.deepEqual(parsed.travelMove.structured.parsed.move_location, ['North Gate']);
    assert.deepEqual(parsed.afterTravel.structured.parsed.thing_move_with_character, [
        { thingName: 'Handcart', characterName: 'player' }
    ]);
    assert.deepEqual(parsed.ignoredDuringEvents, []);
    assert.deepEqual(parsed.structured.parsed.thing_move_with_character, [
        { thingName: 'Handcart', characterName: 'player' }
    ]);
});

test('XML event parser rejects invalid travel boundaries', () => {
    assert.throws(
        () => Events._parseXmlEventCheckResponse('<events><moveLocation><destinationName>A</destinationName></moveLocation></events>'),
        /requires <arriveAtLocation\/?>/i
    );
    assert.throws(
        () => Events._parseXmlEventCheckResponse('<events><arriveAtLocation/></events>'),
        /without a preceding move/i
    );
    assert.throws(
        () => Events._parseXmlEventCheckResponse('<events><moveLocation><destinationName>A</destinationName></moveLocation><arriveAtLocation/><moveLocation><destinationName>B</destinationName></moveLocation></events>'),
        /multiple travel boundaries/i
    );
});

test('hidden NPC reveal and hide events use configured opposed checks before toggling visibility', async () => {
    const previousDeps = Events._deps;
    const previousHandlers = Events._handlers;
    const previousParsers = Events._parsers;
    const previousCurrentPlayer = Globals.currentPlayer;

    const player = { id: 'player-1', name: 'Baato' };
    const shade = {
        id: 'npc-shade',
        name: 'Shade',
        isNPC: true,
        hiddenFromPlayer: true
    };
    const checks = [];

    try {
        Globals.currentPlayer = player;
        Events.initialize({
            getCurrentPlayer: () => player,
            findActorByName: (name) => String(name || '').toLowerCase() === 'shade' ? shade : null,
            ensureNpcByName: async () => null,
            getActiveSettingSnapshot: () => ({
                hidingAttribute: 'Agility',
                hidingSkill: 'Stealth',
                perceptionAttribute: 'Awareness',
                perceptionSkill: 'Notice'
            }),
            resolveActionOutcome: ({ plausibility, player: actingActor }) => {
                checks.push({ plausibility, actingActor });
                return {
                    label: checks.length === 1 ? 'failure' : 'success',
                    degree: checks.length === 1 ? 'failure' : 'success',
                    success: checks.length !== 1,
                    skill: plausibility.skillCheck.skill,
                    attribute: plausibility.skillCheck.attribute,
                    opponent: {
                        name: plausibility.skillCheck.opposedCheck.opponent
                    }
                };
            }
        });

        await Events.applyEventOutcomes({
            parsed: {
                reveal_hidden_npc: [{
                    name: 'Shade',
                    description: 'The lantern catches Shade.',
                    useOpposedCheck: true
                }]
            }
        }, {});

        assert.equal(shade.hiddenFromPlayer, true);
        assert.equal(checks[0].actingActor, player);
        assert.equal(checks[0].plausibility.skillCheck.attribute, 'Awareness');
        assert.equal(checks[0].plausibility.skillCheck.skill, 'Notice');
        assert.equal(checks[0].plausibility.skillCheck.opposedCheck.opponent, 'Shade');
        assert.equal(checks[0].plausibility.skillCheck.opposedCheck.opponentAttribute, 'Agility');

        await Events.applyEventOutcomes({
            parsed: {
                reveal_hidden_npc: [{
                    name: 'Shade',
                    description: 'The lantern catches Shade.',
                    useOpposedCheck: true
                }]
            }
        }, {});

        assert.equal(shade.hiddenFromPlayer, false);

        await Events.applyEventOutcomes({
            parsed: {
                hide_visible_npc: [{
                    name: 'Shade',
                    description: 'Shade slips away.'
                }]
            }
        }, {});

        assert.equal(shade.hiddenFromPlayer, true);
        assert.equal(checks[2].actingActor, shade);
        assert.equal(checks[2].plausibility.skillCheck.attribute, 'Agility');
        assert.equal(checks[2].plausibility.skillCheck.skill, 'Stealth');
        assert.equal(checks[2].plausibility.skillCheck.opposedCheck.opponent, 'Baato');
        assert.equal(checks[2].plausibility.skillCheck.opposedCheck.opponentAttribute, 'Awareness');
    } finally {
        Events._deps = previousDeps;
        Events._handlers = previousHandlers;
        Events._parsers = previousParsers;
        Globals.currentPlayer = previousCurrentPlayer;
    }
});

test('hidden NPC events reuse a matching player-action opposed check instead of rolling twice', async () => {
    const previousDeps = Events._deps;
    const previousHandlers = Events._handlers;
    const previousParsers = Events._parsers;
    const previousCurrentPlayer = Globals.currentPlayer;

    const player = { id: 'player-1', name: 'Baato', isNPC: false, aliases: [] };
    const shade = {
        id: 'npc-shade',
        name: 'Shade',
        aliases: ['Whisper'],
        isNPC: true,
        isDead: false,
        hiddenFromPlayer: true
    };
    let unexpectedRolls = 0;

    try {
        Globals.currentPlayer = player;
        Events.initialize({
            getCurrentPlayer: () => player,
            findActorByName: (name) => ['shade', 'whisper'].includes(String(name || '').toLowerCase()) ? shade : null,
            ensureNpcByName: async () => null,
            getActiveSettingSnapshot: () => ({
                hidingAttribute: 'dexterity',
                hidingSkill: 'Stealth',
                perceptionAttribute: 'wisdom',
                perceptionSkill: 'Perception'
            }),
            resolveActionOutcome: () => {
                unexpectedRolls += 1;
                throw new Error('A matching pre-resolved check must not roll again.');
            }
        });

        const successContext = {
            preResolvedHiddenNpcChecks: [{
                toolName: 'resolveOpposedSkillCheck',
                actorName: 'player',
                opponentName: 'Shade',
                actionResolution: {
                    success: true,
                    skill: 'Perception',
                    attribute: 'wisdom',
                    opponent: {
                        id: shade.id,
                        name: shade.name,
                        skill: 'Stealth',
                        attribute: 'dexterity'
                    }
                }
            }],
            consumedPreResolvedHiddenNpcCheckIndexes: new Set()
        };
        await Events.applyEventOutcomes({
            parsed: {
                reveal_hidden_npc: [{
                    name: 'Whisper',
                    description: 'Baato spots the hidden scout.',
                    useOpposedCheck: true
                }]
            }
        }, successContext);

        assert.equal(shade.hiddenFromPlayer, false);
        assert.equal(successContext.hiddenNpcChecks, undefined);
        assert.equal(unexpectedRolls, 0);

        shade.hiddenFromPlayer = true;
        const failureContext = {
            preResolvedHiddenNpcChecks: [{
                toolName: 'resolveOpposedSkillCheck',
                actorName: 'Baato',
                opponentName: 'Whisper',
                actionResolution: {
                    success: false,
                    skill: 'Perception',
                    attribute: 'wisdom',
                    opponent: {
                        id: shade.id,
                        name: shade.name,
                        skill: 'Stealth',
                        attribute: 'dexterity'
                    }
                }
            }],
            consumedPreResolvedHiddenNpcCheckIndexes: new Set()
        };
        const parsed = {
            parsed: {
                reveal_hidden_npc: [{
                    name: 'Shade',
                    description: 'Baato searches but fails.',
                    useOpposedCheck: true
                }]
            }
        };
        await Events.applyEventOutcomes(parsed, failureContext);

        assert.equal(shade.hiddenFromPlayer, true);
        assert.equal(parsed.parsed.reveal_hidden_npc[0].success, false);
        assert.equal(parsed.parsed.reveal_hidden_npc[0].reusedActionCheck, true);
        assert.equal(failureContext.hiddenNpcChecks, undefined);
        assert.equal(unexpectedRolls, 0);
    } finally {
        Events._deps = previousDeps;
        Events._handlers = previousHandlers;
        Events._parsers = previousParsers;
        Globals.currentPlayer = previousCurrentPlayer;
    }
});

test('XML runEventChecks forwards a pre-resolved hidden NPC check into event outcomes', async () => {
    const previousConfig = Globals.config;
    const previousCurrentPlayer = Globals.currentPlayer;
    const previousChatCompletion = LLMClient.chatCompletion;
    const previousLogPrompt = LLMClient.logPrompt;
    const previousDeps = Events._deps;
    const previousTimeout = Events._baseTimeout;
    const previousHandlers = Events._handlers;
    const previousParsers = Events._parsers;
    const previousAggregators = Events._aggregators;

    const location = { id: 'loc-1', name: 'Marker', things: [] };
    const player = {
        id: 'player-1',
        name: 'Baato',
        aliases: [],
        isNPC: false,
        currentLocation: location.id
    };
    const shade = {
        id: 'npc-shade',
        name: 'Shade',
        aliases: ['Whisper'],
        isNPC: true,
        isDead: false,
        hiddenFromPlayer: true,
        currentLocation: location.id
    };
    let unexpectedRolls = 0;

    try {
        Globals.config = {
            ai: {},
            event_checks: { enabled: true, use_xml: true },
            quests: { enabled: false },
            omit_npc_generation: true
        };
        Globals.currentPlayer = player;
        LLMClient.chatCompletion = async () => `<events>
  <revealHiddenNpc>
    <npcName>Whisper</npcName>
    <description>Baato spots the hidden scout.</description>
    <useOpposedCheck>true</useOpposedCheck>
  </revealHiddenNpc>
</events>`;
        LLMClient.logPrompt = () => {};
        Events.initialize({
            promptEnv: {
                render: () => '<systemPrompt>system</systemPrompt><generationPrompt>generation</generationPrompt>'
            },
            parseXMLTemplate: () => ({
                systemPrompt: 'system',
                generationPrompt: 'generation'
            }),
            prepareBasePromptContext: async () => ({
                needBarDefinitions: [],
                npcs: [shade],
                party: []
            }),
            Location: {
                get: (id) => id === location.id ? location : null
            },
            findRegionByLocationId: () => null,
            getCurrentPlayer: () => player,
            findActorByName: (name) => ['shade', 'whisper'].includes(String(name || '').toLowerCase()) ? shade : null,
            ensureNpcByName: async () => null,
            getActiveSettingSnapshot: () => ({
                hidingAttribute: 'dexterity',
                hidingSkill: 'Stealth',
                perceptionAttribute: 'wisdom',
                perceptionSkill: 'Perception'
            }),
            resolveActionOutcome: () => {
                unexpectedRolls += 1;
                throw new Error('The XML event pipeline must reuse the supplied check.');
            },
            getConfig: () => Globals.config
        });

        const result = await Events.runEventChecks({
            textToCheck: 'Baato spots Whisper.',
            suppressNeedBarEventChecks: true,
            suppressHousekeeping: true,
            preResolvedHiddenNpcChecks: [{
                toolName: 'resolveOpposedSkillCheck',
                actorName: 'player',
                opponentName: shade.name,
                actionResolution: {
                    success: true,
                    skill: 'Perception',
                    attribute: 'intelligence',
                    opponent: {
                        id: shade.id,
                        name: shade.name,
                        skill: 'Stealth',
                        attribute: null
                    }
                }
            }]
        });

        assert.equal(shade.hiddenFromPlayer, false);
        assert.equal(
            result.xmlEvents.beforeTravel.structured.parsed.reveal_hidden_npc[0].reusedActionCheck,
            true
        );
        assert.deepEqual(result.hiddenNpcChecks, []);
        assert.equal(unexpectedRolls, 0);

        const conflictingResolution = {
            success: true,
            skill: 'Investigation',
            attribute: 'wisdom',
            opponent: {
                id: shade.id,
                name: shade.name,
                skill: 'Stealth',
                attribute: 'dexterity'
            }
        };
        const conflictingMatch = Events._consumeMatchingPreResolvedHiddenNpcCheck({
            context: {
                preResolvedHiddenNpcChecks: [{
                    toolName: 'resolveOpposedSkillCheck',
                    actorName: 'player',
                    opponentName: shade.name,
                    actionResolution: conflictingResolution
                }]
            },
            actor: player,
            opponent: shade,
            actorAttribute: 'wisdom',
            actorSkill: 'Perception',
            opponentAttribute: 'dexterity',
            opponentSkill: 'Stealth'
        });
        assert.equal(conflictingMatch, null);
    } finally {
        Events._deps = previousDeps;
        Events._baseTimeout = previousTimeout;
        Events._handlers = previousHandlers;
        Events._parsers = previousParsers;
        Events._aggregators = previousAggregators;
        LLMClient.chatCompletion = previousChatCompletion;
        LLMClient.logPrompt = previousLogPrompt;
        Globals.config = previousConfig;
        Globals.currentPlayer = previousCurrentPlayer;
    }
});

test('mystery_box_mention event runs update prompt and creates a mystery box', async () => {
    const previousChatCompletion = LLMClient.chatCompletion;
    const previousLogPrompt = LLMClient.logPrompt;
    const previousDeps = Events._deps;
    const previousTimeout = Events._baseTimeout;
    const previousParsers = Events._parsers;
    const previousAggregators = Events._aggregators;
    const previousHandlers = Events._handlers;
    const renderedContexts = [];
    const loggedPrefixes = [];

    IdGenerator.reset();
    MysteryBox.clear();
    MysteryThread.clear();

    try {
        LLMClient.chatCompletion = async () => `<mysteryBoxUpdate>
  <action>create</action>
  <thread>
    <name>Ellison Conspiracy</name>
    <status>active</status>
    <summary>Ellison used ELLISON-SEVEN as an evidence trigger.</summary>
    <constraints>
      <constraint>ELLISON-SEVEN is tied to Ellison.</constraint>
    </constraints>
  </thread>
  <name>Captain Ellison</name>
  <keys>
    <key>Captain Ellison</key>
    <key>ELLISON-SEVEN</key>
  </keys>
  <text>Ellison used ELLISON-SEVEN as a private verification protocol and evidence trigger.</text>
</mysteryBoxUpdate>`;
        LLMClient.logPrompt = (entry) => {
            loggedPrefixes.push(entry?.prefix || null);
        };
        Events.initialize({
            promptEnv: {
                render: (_template, context) => {
                    renderedContexts.push(context);
                    return JSON.stringify(context);
                }
            },
            parseXMLTemplate: (rendered) => ({
                systemPrompt: 'system',
                generationPrompt: rendered
            }),
            prepareBasePromptContext: async () => ({
                setting: { name: 'Test Setting' }
            }),
            getConfig: () => ({ ai: {}, max_tool_calls: 8 }),
            getCurrentPlayer: () => ({ name: 'Wanderer' }),
            findActorByName: () => null,
            ensureNpcByName: async () => null
        });

        await Events.applyEventOutcomes({
            rawEntries: {
                mystery_box_mention: "Captain Ellison → Siggy's recovered protocol phrase points to Ellison."
            },
            parsed: {
                mystery_box_mention: [
                    {
                        name: 'Captain Ellison',
                        context: "Siggy's recovered protocol phrase points to Ellison."
                    }
                ]
            }
        }, {
            textToCheck: 'Siggy says the phrase ELLISON-SEVEN unlocked the vault.',
            actionText: 'Ask Siggy what Ellison wanted him to remember.',
            sourceEntryId: 'entry_7'
        });

        const box = MysteryBox.getByKey('ELLISON SEVEN');
        assert.ok(box);
        assert.equal(box.name, 'Captain Ellison');
        assert.match(box.text, /private verification protocol/);
        assert.equal(box.mentions.length, 1);
        assert.equal(box.mentions[0].sourceEntryId, 'entry_7');
        const thread = MysteryThread.getByKey('Ellison Conspiracy');
        assert.ok(thread);
        assert.equal(thread.status, 'active');
        assert.deepEqual(thread.boxIds, [box.id]);
        assert.match(thread.summary, /evidence trigger/);
        assert.equal(renderedContexts[0].promptType, 'mystery-box-update');
        assert.equal(renderedContexts[0].mysteryBoxMention.name, 'Captain Ellison');
        assert.equal(renderedContexts[0].mysteryThreadMaxActive, 2);
        assert.equal(loggedPrefixes.includes('mystery_box_update'), true);
    } finally {
        Events._deps = previousDeps;
        Events._baseTimeout = previousTimeout;
        Events._parsers = previousParsers;
        Events._aggregators = previousAggregators;
        Events._handlers = previousHandlers;
        LLMClient.chatCompletion = previousChatCompletion;
        LLMClient.logPrompt = previousLogPrompt;
        MysteryBox.clear();
        MysteryThread.clear();
    }
});

test('mystery box update parser requires name as canonical key', () => {
    assert.throws(
        () => Events._parseMysteryBoxUpdateResponse(`<mysteryBoxUpdate>
  <action>create</action>
  <keys>
    <key>ELLISON-SEVEN</key>
  </keys>
  <text>Ellison used ELLISON-SEVEN as a private verification protocol.</text>
</mysteryBoxUpdate>`),
        /requires non-empty <name>/i
    );
});

test('mystery box update parser accepts skip without creating a box', () => {
    const parsed = Events._parseMysteryBoxUpdateResponse(`<mysteryBoxUpdate>
  <action>skip</action>
  <reason>Active mystery threads are full and this does not belong to one.</reason>
</mysteryBoxUpdate>`);

    assert.equal(parsed.action, 'skip');
    assert.match(parsed.reason, /threads are full/);
});

test('mystery thread check parser accepts resolved threads and boxes', () => {
    const parsed = Events._parseMysteryThreadCheckResponse(`<resolvedMysteries>
  <mysteryThread>
    <name>Ellison Conspiracy</name>
    <reasoning>Ellison confessed and the remaining evidence only confirms it.</reasoning>
  </mysteryThread>
  <mysteryBox>
    <name>ELLISON-SEVEN</name>
  </mysteryBox>
</resolvedMysteries>`);

    assert.deepEqual(parsed.threads, [
        {
            name: 'Ellison Conspiracy',
            reasoning: 'Ellison confessed and the remaining evidence only confirms it.'
        }
    ]);
    assert.deepEqual(parsed.boxes, [
        {
            name: 'ELLISON-SEVEN'
        }
    ]);
});

test('mystery_box_mention update prompt can use mystery box search tool', async () => {
    const previousChatCompletion = LLMClient.chatCompletion;
    const previousLogPrompt = LLMClient.logPrompt;
    const previousDeps = Events._deps;
    const previousTimeout = Events._baseTimeout;
    const previousParsers = Events._parsers;
    const previousAggregators = Events._aggregators;
    const previousHandlers = Events._handlers;
    const toolNamesByRound = [];

    IdGenerator.reset();
    MysteryBox.clear();
    MysteryThread.clear();
    const existingBox = new MysteryBox({
        name: 'Captain Ellison',
        keys: ['ELLISON-SEVEN'],
        text: 'Initial private note.'
    });
    new MysteryThread({
        name: 'Ellison Conspiracy',
        status: 'active',
        summary: 'Ellison used ELLISON-SEVEN.',
        constraints: ['ELLISON-SEVEN belongs to Ellison.'],
        boxIds: [existingBox.id]
    });

    const responses = [
        {
            data: {
                choices: [
                    {
                        message: {
                            content: `<resolvedMysteries>
</resolvedMysteries>`,
                            tool_calls: []
                        }
                    }
                ]
            }
        },
        {
            data: {
                choices: [
                    {
                        message: {
                            content: '',
                            tool_calls: [
                                {
                                    id: 'call_find_mystery',
                                    type: 'function',
                                    function: {
                                        name: 'findMysteryBoxes',
                                        arguments: JSON.stringify({ query: 'Ellison' })
                                    }
                                }
                            ]
                        }
                    }
                ]
            }
        },
        {
            data: {
                choices: [
                    {
                        message: {
                            content: `<mysteryBoxUpdate>
  <action>update</action>
  <thread>
    <name>Ellison Conspiracy</name>
    <status>active</status>
    <summary>Ellison used ELLISON-SEVEN as a private verification protocol and evidence trigger.</summary>
    <constraints>
      <constraint>ELLISON-SEVEN belongs to Ellison.</constraint>
    </constraints>
  </thread>
  <name>Captain Ellison</name>
  <keys>
    <key>ELLISON-SEVEN</key>
    <key>Omega-7 captain</key>
  </keys>
  <text>Ellison used ELLISON-SEVEN as a private verification protocol and evidence trigger.</text>
</mysteryBoxUpdate>`,
                            tool_calls: []
                        }
                    }
                ]
            }
        }
    ];

    try {
        LLMClient.chatCompletion = async (options) => {
            toolNamesByRound.push((options.additionalPayload?.tools || [])
                .map((tool) => tool?.function?.name)
                .filter(Boolean));
            const response = responses.shift();
            assert.ok(response, 'Expected a queued LLM response.');
            options.onResponse?.(response);
            return response.data.choices[0].message.content || '';
        };
        LLMClient.logPrompt = () => {};
        Events.initialize({
            promptEnv: {
                render: (_template, context) => JSON.stringify(context)
            },
            parseXMLTemplate: (rendered) => ({
                systemPrompt: 'system',
                generationPrompt: rendered
            }),
            prepareBasePromptContext: async () => ({
                setting: { name: 'Test Setting' }
            }),
            getConfig: () => ({ ai: {}, max_tool_calls: 8 }),
            getCurrentPlayer: () => ({ name: 'Wanderer' }),
            findActorByName: () => null,
            ensureNpcByName: async () => null
        });

        await Events.applyEventOutcomes({
            rawEntries: {
                mystery_box_mention: "Captain Ellison → Siggy's recovered protocol phrase points to Ellison."
            },
            parsed: {
                mystery_box_mention: [
                    {
                        name: 'Captain Ellison',
                        context: "Siggy's recovered protocol phrase points to Ellison."
                    }
                ]
            }
        }, {
            textToCheck: 'Siggy says the phrase ELLISON-SEVEN unlocked the vault.',
            actionText: 'Ask Siggy what Ellison wanted him to remember.',
            sourceEntryId: 'entry_8'
        });

        assert.ok(toolNamesByRound.some((names) => names.includes('findMysteryBoxes')));
        assert.ok(toolNamesByRound.some((names) => names.includes('getMysteryBox')));
        assert.ok(toolNamesByRound.some((names) => names.includes('listMysteryBoxes')));
        const box = MysteryBox.getByKey('Omega-7 captain');
        assert.ok(box);
        assert.equal(box.name, 'Captain Ellison');
        assert.match(box.text, /evidence trigger/);
        assert.equal(box.mentions[0].sourceEntryId, 'entry_8');
        const thread = MysteryThread.getByKey('Ellison Conspiracy');
        assert.ok(thread);
        assert.equal(thread.boxIds.includes(box.id), true);
        assert.match(thread.summary, /evidence trigger/);
    } finally {
        Events._deps = previousDeps;
        Events._baseTimeout = previousTimeout;
        Events._parsers = previousParsers;
        Events._aggregators = previousAggregators;
        Events._handlers = previousHandlers;
        LLMClient.chatCompletion = previousChatCompletion;
        LLMClient.logPrompt = previousLogPrompt;
        MysteryBox.clear();
        MysteryThread.clear();
    }
});

test('mystery_box_mention skips unrelated mentions when active thread capacity is full', async () => {
    const previousChatCompletion = LLMClient.chatCompletion;
    const previousLogPrompt = LLMClient.logPrompt;
    const previousDeps = Events._deps;
    const previousTimeout = Events._baseTimeout;
    const previousParsers = Events._parsers;
    const previousAggregators = Events._aggregators;
    const previousHandlers = Events._handlers;
    const renderedContexts = [];

    IdGenerator.reset();
    MysteryBox.clear();
    MysteryThread.clear();
    new MysteryThread({
        name: 'Existing Active Thread',
        status: 'active',
        summary: 'A different active mystery.',
        constraints: ['Only this thread is active.']
    });

    try {
        const responses = [
            `<resolvedMysteries>
</resolvedMysteries>`,
            `<mysteryBoxUpdate>
  <action>skip</action>
  <reason>Active mystery thread capacity is full and this unrelated mention does not belong to any active thread.</reason>
</mysteryBoxUpdate>`
        ];
        LLMClient.chatCompletion = async () => {
            const response = responses.shift();
            assert.ok(response, 'Expected a queued LLM response.');
            return response;
        };
        LLMClient.logPrompt = () => {};
        Events.initialize({
            promptEnv: {
                render: (_template, context) => {
                    renderedContexts.push(context);
                    return JSON.stringify(context);
                }
            },
            parseXMLTemplate: (rendered) => ({
                systemPrompt: 'system',
                generationPrompt: rendered
            }),
            prepareBasePromptContext: async () => ({
                setting: { name: 'Test Setting' }
            }),
            getConfig: () => ({ ai: {}, max_tool_calls: 8, mystery_threads: { max_active: 1 } }),
            getCurrentPlayer: () => ({ name: 'Wanderer' }),
            findActorByName: () => null,
            ensureNpcByName: async () => null
        });

        await Events.applyEventOutcomes({
            rawEntries: {
                mystery_box_mention: 'Unrelated Clue → A new unrelated mystery appears.'
            },
            parsed: {
                mystery_box_mention: [
                    {
                        name: 'Unrelated Clue',
                        context: 'A new unrelated mystery appears.'
                    }
                ]
            }
        }, {
            textToCheck: 'A new unrelated clue appears.',
            sourceEntryId: 'entry_skip'
        });

        assert.equal(MysteryBox.getAll().length, 0);
        assert.equal(MysteryThread.getAll().length, 1);
        const updateContext = renderedContexts.find((context) => context.promptType === 'mystery-box-update');
        assert.ok(updateContext);
        assert.equal(updateContext.mysteryThreadCapacityFull, true);
        assert.equal(updateContext.mysteryThreadMaxActive, 1);
    } finally {
        Events._deps = previousDeps;
        Events._baseTimeout = previousTimeout;
        Events._parsers = previousParsers;
        Events._aggregators = previousAggregators;
        Events._handlers = previousHandlers;
        LLMClient.chatCompletion = previousChatCompletion;
        LLMClient.logPrompt = previousLogPrompt;
        MysteryBox.clear();
        MysteryThread.clear();
    }
});

test('mystery_box_mention runs mystery thread check before update and frees resolved active capacity', async () => {
    const previousChatCompletion = LLMClient.chatCompletion;
    const previousLogPrompt = LLMClient.logPrompt;
    const previousDeps = Events._deps;
    const previousTimeout = Events._baseTimeout;
    const previousParsers = Events._parsers;
    const previousAggregators = Events._aggregators;
    const previousHandlers = Events._handlers;
    const renderedContexts = [];
    const loggedPrefixes = [];

    IdGenerator.reset();
    MysteryBox.clear();
    MysteryThread.clear();
    const resolvedThread = new MysteryThread({
        name: 'Existing Active Thread',
        status: 'active',
        summary: 'A mystery that has now been answered.',
        constraints: ['The culprit has confessed.']
    });

    const responses = [
        `<resolvedMysteries>
  <mysteryThread>
    <name>Existing Active Thread</name>
    <reasoning>The culprit confessed on screen, so this no longer needs active continuity.</reasoning>
  </mysteryThread>
</resolvedMysteries>`,
        `<mysteryBoxUpdate>
  <action>create</action>
  <thread>
    <name>New Signal</name>
    <status>active</status>
    <summary>The new signal points to a separate unresolved actor.</summary>
    <constraints>
      <constraint>The signal is unrelated to the resolved confession.</constraint>
    </constraints>
  </thread>
  <name>New Signal</name>
  <keys>
    <key>signal</key>
  </keys>
  <text>The signal is a separate unresolved clue created after the older thread resolved.</text>
</mysteryBoxUpdate>`
    ];

    try {
        LLMClient.chatCompletion = async () => {
            const response = responses.shift();
            assert.ok(response, 'Expected a queued LLM response.');
            return response;
        };
        LLMClient.logPrompt = (entry) => {
            loggedPrefixes.push(entry?.prefix || null);
        };
        Events.initialize({
            promptEnv: {
                render: (template, context) => {
                    renderedContexts.push({ template, context });
                    return JSON.stringify(context);
                }
            },
            parseXMLTemplate: (rendered) => ({
                systemPrompt: 'system',
                generationPrompt: rendered
            }),
            prepareBasePromptContext: async () => ({
                setting: { name: 'Test Setting' }
            }),
            getConfig: () => ({ ai: {}, max_tool_calls: 8, mystery_threads: { max_active: 1 } }),
            getCurrentPlayer: () => ({ name: 'Wanderer' }),
            findActorByName: () => null,
            ensureNpcByName: async () => null
        });

        await Events.applyEventOutcomes({
            rawEntries: {
                mystery_box_mention: 'New Signal → The confession ends one mystery, but a fresh signal appears.'
            },
            parsed: {
                mystery_box_mention: [
                    {
                        name: 'New Signal',
                        context: 'The confession ends one mystery, but a fresh signal appears.'
                    }
                ]
            }
        }, {
            textToCheck: 'The culprit confessed, then a new signal blinked from the sealed console.',
            sourceEntryId: 'entry_thread_check'
        });

        assert.equal(resolvedThread.status, 'inactive');
        const newThread = MysteryThread.getByKey('New Signal');
        assert.ok(newThread);
        assert.equal(newThread.status, 'active');
        assert.equal(MysteryThread.getActive({ max: Number.MAX_SAFE_INTEGER }).length, 1);
        assert.equal(renderedContexts[0].context.promptType, 'mystery-thread-check');
        assert.deepEqual(
            renderedContexts[0].context.activeMysteryThreads.map(thread => thread.name),
            ['Existing Active Thread']
        );
        assert.equal(renderedContexts[1].context.promptType, 'mystery-box-update');
        assert.equal(renderedContexts[1].context.mysteryThreadActiveCount, 0);
        assert.equal(renderedContexts[1].context.mysteryThreadCapacityFull, false);
        assert.equal(loggedPrefixes.includes('mystery_thread_check'), true);
        assert.equal(loggedPrefixes.includes('mystery_box_update'), true);
    } finally {
        Events._deps = previousDeps;
        Events._baseTimeout = previousTimeout;
        Events._parsers = previousParsers;
        Events._aggregators = previousAggregators;
        Events._handlers = previousHandlers;
        LLMClient.chatCompletion = previousChatCompletion;
        LLMClient.logPrompt = previousLogPrompt;
        MysteryBox.clear();
        MysteryThread.clear();
    }
});

test('mystery thread check can resolve a box while leaving its active thread visible without that box', async () => {
    const previousChatCompletion = LLMClient.chatCompletion;
    const previousLogPrompt = LLMClient.logPrompt;
    const previousDeps = Events._deps;
    const previousTimeout = Events._baseTimeout;
    const previousParsers = Events._parsers;
    const previousAggregators = Events._aggregators;
    const previousHandlers = Events._handlers;
    const renderedContexts = [];

    IdGenerator.reset();
    MysteryBox.clear();
    MysteryThread.clear();
    const resolvedBox = new MysteryBox({
        name: 'ELLISON-SEVEN',
        keys: ['Captain Ellison protocol'],
        text: 'The private phrase proves Ellison authored the vault protocol.'
    });
    const unresolvedBox = new MysteryBox({
        name: 'Omega Witness',
        keys: ['unknown witness'],
        text: 'An unidentified witness still knows who funded the protocol.'
    });
    const thread = new MysteryThread({
        name: 'Ellison Conspiracy',
        status: 'active',
        summary: 'Ellison used a secret protocol, but the witness remains unidentified.',
        constraints: ['ELLISON-SEVEN was Ellison’s phrase.'],
        boxIds: [resolvedBox.id, unresolvedBox.id]
    });

    const responses = [
        `<resolvedMysteries>
  <mysteryBox>
    <name>ELLISON-SEVEN</name>
  </mysteryBox>
</resolvedMysteries>`,
        `<mysteryBoxUpdate>
  <action>skip</action>
  <reason>The new mention only confirms an already resolved box.</reason>
</mysteryBoxUpdate>`
    ];

    try {
        LLMClient.chatCompletion = async () => {
            const response = responses.shift();
            assert.ok(response, 'Expected a queued LLM response.');
            return response;
        };
        LLMClient.logPrompt = () => {};
        Events.initialize({
            promptEnv: {
                render: (_template, context) => {
                    renderedContexts.push(context);
                    return JSON.stringify(context);
                }
            },
            parseXMLTemplate: (rendered) => ({
                systemPrompt: 'system',
                generationPrompt: rendered
            }),
            prepareBasePromptContext: async () => ({
                setting: { name: 'Test Setting' }
            }),
            getConfig: () => ({ ai: {}, max_tool_calls: 8, mystery_threads: { max_active: 1 } }),
            getCurrentPlayer: () => ({ name: 'Wanderer' }),
            findActorByName: () => null,
            ensureNpcByName: async () => null
        });

        await Events.applyEventOutcomes({
            rawEntries: {
                mystery_box_mention: 'ELLISON-SEVEN → Ellison admits the phrase is his.'
            },
            parsed: {
                mystery_box_mention: [
                    {
                        name: 'ELLISON-SEVEN',
                        context: 'Ellison admits the phrase is his.'
                    }
                ]
            }
        }, {
            textToCheck: 'Ellison says ELLISON-SEVEN was his private phrase.',
            sourceEntryId: 'entry_resolved_box'
        });

        assert.equal(resolvedBox.resolved, true);
        assert.equal(thread.status, 'active');
        const updateContext = renderedContexts.find((context) => context.promptType === 'mystery-box-update');
        assert.ok(updateContext);
        assert.deepEqual(updateContext.activeMysteryThreads[0].mysteryBoxes.map(box => box.name), ['Omega Witness']);
        assert.deepEqual(updateContext.mysteryBoxes.map(box => box.name), ['Omega Witness']);
    } finally {
        Events._deps = previousDeps;
        Events._baseTimeout = previousTimeout;
        Events._parsers = previousParsers;
        Events._aggregators = previousAggregators;
        Events._handlers = previousHandlers;
        LLMClient.chatCompletion = previousChatCompletion;
        LLMClient.logPrompt = previousLogPrompt;
        MysteryBox.clear();
        MysteryThread.clear();
    }
});

test('mystery thread check warns and continues when resolved name does not match an active thread', async () => {
    const previousChatCompletion = LLMClient.chatCompletion;
    const previousLogPrompt = LLMClient.logPrompt;
    const previousWarn = console.warn;
    const previousDeps = Events._deps;
    const previousTimeout = Events._baseTimeout;
    const previousParsers = Events._parsers;
    const previousAggregators = Events._aggregators;
    const previousHandlers = Events._handlers;
    const warnings = [];

    IdGenerator.reset();
    MysteryBox.clear();
    MysteryThread.clear();
    const activeThread = new MysteryThread({
        name: 'Existing Active Thread',
        status: 'active',
        summary: 'Still unresolved.',
        constraints: ['Keep this thread active.']
    });

    const responses = [
        `<resolvedMysteries>
  <mysteryThread>
    <name>Imaginary Thread</name>
    <reasoning>The model named a thread that is not active.</reasoning>
  </mysteryThread>
</resolvedMysteries>`,
        `<mysteryBoxUpdate>
  <action>skip</action>
  <reason>Active mystery thread capacity is full and this unrelated mention does not belong to any active thread.</reason>
</mysteryBoxUpdate>`
    ];

    try {
        LLMClient.chatCompletion = async () => {
            const response = responses.shift();
            assert.ok(response, 'Expected a queued LLM response.');
            return response;
        };
        LLMClient.logPrompt = () => {};
        console.warn = (...args) => {
            warnings.push(args.join(' '));
        };
        Events.initialize({
            promptEnv: {
                render: (_template, context) => JSON.stringify(context)
            },
            parseXMLTemplate: (rendered) => ({
                systemPrompt: 'system',
                generationPrompt: rendered
            }),
            prepareBasePromptContext: async () => ({
                setting: { name: 'Test Setting' }
            }),
            getConfig: () => ({ ai: {}, max_tool_calls: 8, mystery_threads: { max_active: 1 } }),
            getCurrentPlayer: () => ({ name: 'Wanderer' }),
            findActorByName: () => null,
            ensureNpcByName: async () => null
        });

        await Events.applyEventOutcomes({
            rawEntries: {
                mystery_box_mention: 'Unrelated Clue → A new unrelated mystery appears.'
            },
            parsed: {
                mystery_box_mention: [
                    {
                        name: 'Unrelated Clue',
                        context: 'A new unrelated mystery appears.'
                    }
                ]
            }
        }, {
            textToCheck: 'A new unrelated clue appears.',
            sourceEntryId: 'entry_unknown_thread'
        });

        assert.equal(activeThread.status, 'active');
        assert.equal(MysteryBox.getAll().length, 0);
        assert.ok(
            warnings.some((message) => /mystery thread check.*Imaginary Thread.*active thread/i.test(message)),
            `Expected warning for unknown resolved thread name. Warnings: ${warnings.join('\n')}`
        );
    } finally {
        Events._deps = previousDeps;
        Events._baseTimeout = previousTimeout;
        Events._parsers = previousParsers;
        Events._aggregators = previousAggregators;
        Events._handlers = previousHandlers;
        LLMClient.chatCompletion = previousChatCompletion;
        LLMClient.logPrompt = previousLogPrompt;
        console.warn = previousWarn;
        MysteryBox.clear();
        MysteryThread.clear();
    }
});

test('runEventChecks defaults to XML events plus dedicated need-bar prompt without grouped prompts', async () => {
    const previousConfig = Globals.config;
    const previousCurrentPlayer = Globals.currentPlayer;
    const previousChatCompletion = LLMClient.chatCompletion;
    const previousLogPrompt = LLMClient.logPrompt;
    const previousDeps = Events._deps;
    const previousTimeout = Events._baseTimeout;
    const previousParsers = Events._parsers;
    const previousAggregators = Events._aggregators;
    const previousHandlers = Events._handlers;
    const capturedPromptTypes = [];
    const loggedPrefixes = [];
    let eventCheckResolved = false;
    let needBarStartedBeforeEventCheckResolved = false;
    const player = {
        isNPC: false,
        name: 'Wanderer',
        currency: 0,
        getCurrency() {
            return this.currency;
        },
        adjustCurrency(amount) {
            this.currency += amount;
        },
        applyNeedBarChange(bar, change) {
            return {
                actorName: this.name,
                needBarId: bar,
                direction: change.direction,
                magnitude: change.magnitude,
                reason: change.reason || null
            };
        }
    };

    try {
        Globals.config = {
            ai: {},
            event_checks: { enabled: true },
            quests: { enabled: false },
            omit_npc_generation: true
        };
        Globals.currentPlayer = player;
        LLMClient.chatCompletion = async (options = {}) => {
            const message = Array.isArray(options.messages) ? options.messages[1]?.content : null;
            const payload = typeof message === 'string' ? JSON.parse(message) : {};
            capturedPromptTypes.push(payload.promptType || null);
            if (payload.promptType === 'need-bars') {
                if (!eventCheckResolved) {
                    needBarStartedBeforeEventCheckResolved = true;
                }
                return `<characters>
  <character>
    <name>Wanderer</name>
    <affectedNeedBars>
      <needBar>
        <id>stamina</id>
        <changeDirection>decrease</changeDirection>
        <change>small</change>
        <reason>counted coins</reason>
      </needBar>
    </affectedNeedBars>
  </character>
</characters>`;
            }
            await new Promise(resolve => setImmediate(resolve));
            eventCheckResolved = true;
            return '<events><currency><amount>7</amount></currency></events>';
        };
        LLMClient.logPrompt = (entry) => {
            loggedPrefixes.push(entry?.prefix || null);
        };
        Events.initialize({
            promptEnv: {
                render: (_template, context) => JSON.stringify({
                    promptType: context.promptType,
                    needBarDefinitions: [{ id: 'stamina', name: 'Stamina' }]
                })
            },
            parseXMLTemplate: (rendered) => ({
                systemPrompt: 'system',
                generationPrompt: rendered
            }),
            prepareBasePromptContext: async () => ({
                needBarDefinitions: [{ id: 'stamina', name: 'Stamina' }],
                npcs: [],
                party: []
            }),
            Location: {
                get: () => null
            },
            findRegionByLocationId: () => null,
            findActorByName: (name) => {
                if (typeof name === 'string' && name.trim() === 'Wanderer') {
                    return player;
                }
                return null;
            },
            getCurrentPlayer: () => player,
            getConfig: () => Globals.config
        });

        const result = await Events.runEventChecks({
            textToCheck: 'Wanderer finds seven coins.'
        });

        assert.deepEqual(capturedPromptTypes, ['events-xml', 'need-bars']);
        assert.equal(needBarStartedBeforeEventCheckResolved, false);
        assert.equal(loggedPrefixes.includes('event_checks_xml'), true);
        assert.equal(loggedPrefixes.includes('need_bar_event_checks'), true);
        assert.equal(result.currencyChanges.length, 1);
        assert.equal(result.currencyChanges[0].amount, 7);
        assert.equal(result.needBarChanges.length, 1);
        assert.equal(result.needBarChanges[0].needBarId, 'stamina');
        assert.equal(result.structured.parsed.needbar_change[0].reason, 'counted coins');
        assert.equal(player.currency, 7);
    } finally {
        Events._deps = previousDeps;
        Events._baseTimeout = previousTimeout;
        Events._parsers = previousParsers;
        Events._aggregators = previousAggregators;
        Events._handlers = previousHandlers;
        LLMClient.chatCompletion = previousChatCompletion;
        LLMClient.logPrompt = previousLogPrompt;
        Globals.config = previousConfig;
        Globals.currentPlayer = previousCurrentPlayer;
    }
});

test('runEventChecks can suppress need-bar checks and hard-ignore selected XML event keys', async () => {
    const previousConfig = Globals.config;
    const previousCurrentPlayer = Globals.currentPlayer;
    const previousChatCompletion = LLMClient.chatCompletion;
    const previousLogPrompt = LLMClient.logPrompt;
    const previousDeps = Events._deps;
    const previousTimeout = Events._baseTimeout;
    const previousParsers = Events._parsers;
    const previousAggregators = Events._aggregators;
    const previousHandlers = Events._handlers;
    const capturedPromptTypes = [];
    const renderedContexts = [];
    const player = {
        isNPC: false,
        name: 'Wanderer',
        currency: 0,
        getCurrency() {
            return this.currency;
        },
        adjustCurrency(amount) {
            this.currency += amount;
        }
    };

    try {
        Globals.config = {
            ai: {},
            event_checks: { enabled: true },
            quests: { enabled: false },
            omit_npc_generation: true
        };
        Globals.currentPlayer = player;
        LLMClient.chatCompletion = async (options = {}) => {
            const message = Array.isArray(options.messages) ? options.messages[1]?.content : null;
            const payload = typeof message === 'string' ? JSON.parse(message) : {};
            capturedPromptTypes.push(payload.promptType || null);
            assert.notEqual(payload.promptType, 'need-bars');
            return `<events>
  <currency><amount>4</amount></currency>
  <needBarChange>
    <characterName>Wanderer</characterName>
    <needBarId>stamina</needBarId>
    <direction>decrease</direction>
    <magnitude>small</magnitude>
    <reason>walked</reason>
  </needBarChange>
  <npcArrivalDeparture>
    <npcName>Mira</npcName>
    <action>arrived</action>
  </npcArrivalDeparture>
  <thingDeparture>
    <thingName>Supply Wagon</thingName>
    <destinationRegion>Town</destinationRegion>
    <destinationLocation>Stable Yard</destinationLocation>
  </thingDeparture>
</events>`;
        };
        LLMClient.logPrompt = () => {};
        Events.initialize({
            promptEnv: {
                render: (_template, context) => {
                    renderedContexts.push(context);
                    return JSON.stringify({
                        promptType: context.promptType,
                        ignored: context.eventCheckIgnoredEventKeys || [],
                        ignoreInstructions: context.eventCheckIgnoreInstructions || ''
                    });
                }
            },
            parseXMLTemplate: (rendered) => ({
                systemPrompt: 'system',
                generationPrompt: rendered
            }),
            prepareBasePromptContext: async () => ({
                needBarDefinitions: [{ id: 'stamina', name: 'Stamina' }],
                npcs: [],
                party: []
            }),
            Location: {
                get: () => null
            },
            findRegionByLocationId: () => null,
            findActorByName: () => null,
            getCurrentPlayer: () => player,
            getConfig: () => Globals.config
        });

        const result = await Events.runEventChecks({
            textToCheck: 'Wanderer finds coins while Mira arrives and everyone gets tired.',
            suppressNeedBarEventChecks: true,
            ignoredEventKeys: ['needbar_change', 'npc_arrival_departure', 'thing_departure'],
            eventCheckIgnoreInstructions: 'Ignore need bars and arrivals.'
        });

        assert.deepEqual(capturedPromptTypes, ['events-xml']);
        assert.deepEqual(renderedContexts[0].eventCheckIgnoredEventKeys.sort(), ['needbar_change', 'npc_arrival_departure', 'thing_arrival_departure'].sort());
        assert.match(renderedContexts[0].eventCheckIgnoreInstructions, /Ignore need bars and arrivals/);
        assert.deepEqual(result.currencyChanges.map(entry => entry.amount), [4]);
        assert.equal(result.structured.parsed.needbar_change, undefined);
        assert.equal(result.structured.parsed.npc_arrival_departure, undefined);
        assert.equal(result.structured.parsed.thing_arrival_departure, undefined);
        assert.deepEqual(result.needBarChanges, []);
        assert.deepEqual(result.npcUpdates.added, []);
        assert.equal(player.currency, 4);
    } finally {
        Events._deps = previousDeps;
        Events._baseTimeout = previousTimeout;
        Events._parsers = previousParsers;
        Events._aggregators = previousAggregators;
        Events._handlers = previousHandlers;
        LLMClient.chatCompletion = previousChatCompletion;
        LLMClient.logPrompt = previousLogPrompt;
        Globals.config = previousConfig;
        Globals.currentPlayer = previousCurrentPlayer;
    }
});

test('runEventChecks uses grouped legacy pathway when event_checks.use_xml is false', async () => {
    const previousConfig = Globals.config;
    const previousCurrentPlayer = Globals.currentPlayer;
    const previousChatCompletion = LLMClient.chatCompletion;
    const previousLogPrompt = LLMClient.logPrompt;
    const previousDeps = Events._deps;
    const previousTimeout = Events._baseTimeout;
    const previousParsers = Events._parsers;
    const previousAggregators = Events._aggregators;
    const previousHandlers = Events._handlers;
    const capturedPromptTypes = [];
    const player = {
        isNPC: false,
        currency: 0,
        getCurrency() {
            return this.currency;
        },
        adjustCurrency(amount) {
            this.currency += amount;
        }
    };

    try {
        Globals.config = {
            ai: {},
            event_checks: { enabled: true, use_xml: false },
            quests: { enabled: false },
            omit_npc_generation: true
        };
        Globals.currentPlayer = player;
        LLMClient.chatCompletion = async (options = {}) => {
            const message = Array.isArray(options.messages) ? options.messages[1]?.content : null;
            const payload = typeof message === 'string' ? JSON.parse(message) : {};
            capturedPromptTypes.push(payload.promptType || null);
            const questionCount = Array.isArray(payload.eventQuestions)
                ? payload.eventQuestions.length
                : 0;
            const answers = Array.from({ length: questionCount }, (_, index) => `${index + 1}. N/A`).join('\n');
            return `<final>\n${answers}\n</final>`;
        };
        LLMClient.logPrompt = () => {};
        Events.initialize({
            promptEnv: {
                render: (_template, context) => JSON.stringify({
                    promptType: context.promptType,
                    eventQuestions: context.eventQuestions || [],
                    needBarDefinitions: []
                })
            },
            parseXMLTemplate: (rendered) => ({
                systemPrompt: 'system',
                generationPrompt: rendered
            }),
            prepareBasePromptContext: async () => ({
                needBarDefinitions: [],
                npcs: [],
                party: []
            }),
            Location: {
                get: () => null
            },
            findRegionByLocationId: () => null,
            getCurrentPlayer: () => player,
            getConfig: () => Globals.config
        });

        await Events.runEventChecks({
            textToCheck: 'Nothing changes.'
        });

        assert.equal(capturedPromptTypes.includes('events-xml'), false);
        assert.deepEqual(capturedPromptTypes, ['event-checks', 'event-checks']);
    } finally {
        Events._deps = previousDeps;
        Events._baseTimeout = previousTimeout;
        Events._parsers = previousParsers;
        Events._aggregators = previousAggregators;
        Events._handlers = previousHandlers;
        LLMClient.chatCompletion = previousChatCompletion;
        LLMClient.logPrompt = previousLogPrompt;
        Globals.config = previousConfig;
        Globals.currentPlayer = previousCurrentPlayer;
    }
});

test('XML runEventChecks applies origin, movement, and destination phases while ignoring transit tags', async () => {
    const previousConfig = Globals.config;
    const previousCurrentPlayer = Globals.currentPlayer;
    const previousProcessedMove = Globals.processedMove;
    const previousAdvanceTime = Globals.advanceTime;
    const previousChatCompletion = LLMClient.chatCompletion;
    const previousLogPrompt = LLMClient.logPrompt;
    const previousDeps = Events._deps;
    const previousTimeout = Events._baseTimeout;
    const previousParsers = Events._parsers;
    const previousAggregators = Events._aggregators;
    const previousHandlers = Events._handlers;
    const origin = { id: 'origin', name: 'Origin', things: [] };
    const destination = { id: 'dest', name: 'North Gate', things: [] };
    const locations = new Map([
        ['origin', origin],
        ['Origin', origin],
        ['dest', destination],
        ['North Gate', destination]
    ]);
    const player = {
        isNPC: false,
        currentLocation: 'origin',
        currency: 0,
        getCurrency() {
            return this.currency;
        },
        adjustCurrency(amount) {
            this.currency += amount;
        },
        setLocation(locationId) {
            this.currentLocation = locationId;
        }
    };
    const timeAdvancements = [];
    const sceneryContextLocationIds = [];

    try {
        Globals.config = {
            ai: {},
            event_checks: { enabled: true },
            quests: { enabled: false },
            omit_npc_generation: true
        };
        Globals.currentPlayer = player;
        Globals.processedMove = false;
        Globals.advanceTime = (minutes, options = {}) => {
            timeAdvancements.push({ minutes, source: options.source || null });
            return { advancedMinutes: minutes, source: options.source || null };
        };
        LLMClient.chatCompletion = async () => `<events>
  <currency><amount>2</amount></currency>
  <moveLocation><destinationName>North Gate</destinationName></moveLocation>
  <itemAppear><fullItemName>Road Dust</fullItemName><quantity>1</quantity><description>In transit.</description></itemAppear>
  <arriveAtLocation/>
  <sceneryAppear><sceneryName>Gatehouse</sceneryName><description>A guarded entry.</description></sceneryAppear>
  <timePassed><reasoning>Looking around the gate.</reasoning><duration>5 minutes</duration></timePassed>
</events>`;
        LLMClient.logPrompt = () => {};
        Events.initialize({
            promptEnv: {
                render: (_template, context) => JSON.stringify({
                    promptType: context.promptType
                })
            },
            parseXMLTemplate: (rendered) => ({
                systemPrompt: 'system',
                generationPrompt: rendered
            }),
            prepareBasePromptContext: async () => ({
                needBarDefinitions: [],
                npcs: [],
                party: []
            }),
            Location: {
                get: (reference) => locations.get(reference) || null,
                findByName: (name) => locations.get(name) || null,
                findShortestTravelTimeMinutes: (from, to) => {
                    const fromId = typeof from === 'string' ? from : from?.id;
                    const toId = typeof to === 'string' ? to : to?.id;
                    if (fromId === 'origin' && toId === 'dest') {
                        return 12;
                    }
                    return null;
                }
            },
            findRegionByLocationId: (locationId) => ({ id: `region-${locationId}`, name: `Region ${locationId}` }),
            getCurrentPlayer: () => player,
            getConfig: () => Globals.config
        });
        Events._handlers = {
            ...Events._handlers,
            scenery_appear: async function (_entries, context = {}) {
                sceneryContextLocationIds.push(context.location?.id || null);
            },
            item_appear: async function () {
                throw new Error('in-transit itemAppear should not be applied');
            }
        };

        const result = await Events.runEventChecks({
            textToCheck: 'The player finds coins, walks to the North Gate, and looks around.'
        });

        assert.equal(player.currentLocation, 'dest');
        assert.deepEqual(timeAdvancements, [
            { minutes: 12, source: 'event_move_travel' }
        ]);
        assert.equal(result.timeProgress.advancedMinutes, 12);
        assert.deepEqual(sceneryContextLocationIds, ['dest']);
        assert.equal(result.currencyChanges.length, 1);
        assert.equal(result.currencyChanges[0].amount, 2);
        assert.deepEqual(result.xmlEvents.ignoredDuringEvents.map(entry => entry.tagName), ['itemAppear']);
    } finally {
        Events._deps = previousDeps;
        Events._baseTimeout = previousTimeout;
        Events._parsers = previousParsers;
        Events._aggregators = previousAggregators;
        Events._handlers = previousHandlers;
        LLMClient.chatCompletion = previousChatCompletion;
        LLMClient.logPrompt = previousLogPrompt;
        Globals.advanceTime = previousAdvanceTime;
        Globals.config = previousConfig;
        Globals.currentPlayer = previousCurrentPlayer;
        Globals.processedMove = previousProcessedMove;
    }
});

test('XML runEventChecks can apply suppressed travel arrival phase at explicit destination', async () => {
    const previousConfig = Globals.config;
    const previousCurrentPlayer = Globals.currentPlayer;
    const previousProcessedMove = Globals.processedMove;
    const previousChatCompletion = LLMClient.chatCompletion;
    const previousLogPrompt = LLMClient.logPrompt;
    const previousDeps = Events._deps;
    const previousTimeout = Events._baseTimeout;
    const previousParsers = Events._parsers;
    const previousAggregators = Events._aggregators;
    const previousHandlers = Events._handlers;

    const things = new Map();
    const locations = new Map();
    const destinationRegion = {
        id: 'region_dest',
        name: 'Lancaster Maintenance Substation',
        locationIds: ['dest']
    };
    const createLocation = (id, name, regionId = null) => {
        const thingIds = new Set();
        const location = {
            id,
            name,
            regionId,
            addThingId(thingId) {
                for (const candidate of new Set(locations.values())) {
                    candidate._thingIds.delete(thingId);
                }
                thingIds.add(thingId);
                const thing = things.get(thingId);
                if (thing) {
                    thing.metadata = { ...(thing.metadata || {}), locationId: id };
                }
            },
            removeThingId(thingId) {
                const removed = thingIds.delete(thingId);
                const thing = things.get(thingId);
                if (removed && thing?.metadata?.locationId === id) {
                    const metadata = { ...thing.metadata };
                    delete metadata.locationId;
                    thing.metadata = metadata;
                }
                return removed;
            },
            hasThing(thingId) {
                return thingIds.has(thingId);
            },
            get _thingIds() {
                return thingIds;
            }
        };
        locations.set(id, location);
        locations.set(name, location);
        return location;
    };

    const origin = createLocation('origin', 'Living Area', 'region_origin');
    const destination = createLocation('dest', 'Main Junction Hub', destinationRegion.id);
    const display = {
        id: 'thing_display',
        name: 'Wall-Mounted Display Screen',
        metadata: {},
        removeFromWorld() {
            for (const location of new Set(locations.values())) {
                location.removeThingId(this.id);
            }
        },
        putInLocation(locationId) {
            const location = locations.get(locationId);
            if (!location) {
                throw new Error(`Location ${locationId} missing`);
            }
            location.addThingId(this.id);
        }
    };
    const fern = {
        id: 'thing_fern',
        name: 'Planted Fern in Cracked Hydroplanter',
        metadata: {},
        removeFromWorld() {
            for (const location of new Set(locations.values())) {
                location.removeThingId(this.id);
            }
        },
        putInLocation(locationId) {
            const location = locations.get(locationId);
            if (!location) {
                throw new Error(`Location ${locationId} missing`);
            }
            location.addThingId(this.id);
        }
    };
    things.set(display.id, display);
    things.set(fern.id, fern);
    origin.addThingId(display.id);
    origin.addThingId(fern.id);

    const player = {
        isNPC: false,
        name: 'Baato',
        currentLocation: origin.id,
        setLocation(locationOrId) {
            this.currentLocation = typeof locationOrId === 'string'
                ? locationOrId
                : locationOrId?.id || null;
        }
    };
    const arrivalPlayerLocations = [];
    const arrivalContextLocations = [];

    try {
        Globals.config = {
            ai: {},
            event_checks: { enabled: true },
            quests: { enabled: false },
            omit_npc_generation: true
        };
        Globals.currentPlayer = player;
        Globals.processedMove = false;
        LLMClient.chatCompletion = async () => `<events>
  <thingMoveWithCharacter>
    <thingName>Planted Fern in Cracked Hydroplanter</thingName>
    <characterName>Baato</characterName>
  </thingMoveWithCharacter>
  <thingDeparture>
    <thingName>Wall-Mounted Display Screen</thingName>
    <destinationRegion>Lancaster Maintenance Substation</destinationRegion>
    <destinationLocation>Main Junction Hub</destinationLocation>
  </thingDeparture>
  <moveLocation><destinationName>Main Junction Hub</destinationName></moveLocation>
  <arriveAtLocation/>
  <thingArrival><thingName>Wall-Mounted Display Screen</thingName></thingArrival>
  <sceneryAppear><sceneryName>Arrival Marker</sceneryName><description>Records arrival context.</description></sceneryAppear>
</events>`;
        LLMClient.logPrompt = () => {};
        Events.initialize({
            promptEnv: {
                render: (_template, context) => JSON.stringify({ promptType: context.promptType })
            },
            parseXMLTemplate: (rendered) => ({
                systemPrompt: 'system',
                generationPrompt: rendered
            }),
            prepareBasePromptContext: async () => ({
                needBarDefinitions: [],
                npcs: [],
                party: []
            }),
            Location: {
                get: (reference) => locations.get(reference) || null,
                findByName: (name) => locations.get(name) || null,
                findShortestTravelTimeMinutes: () => 7
            },
            findLocationByNameLoose: (name) => locations.get(name) || null,
            findRegionByNameLoose: () => destinationRegion,
            findRegionByLocationId: (locationId) => ({ id: `region-${locationId}`, name: `Region ${locationId}` }),
            findThingByName: (name) => {
                const normalized = String(name || '').trim().toLowerCase();
                return Array.from(things.values()).find(thing => thing.name.toLowerCase() === normalized) || null;
            },
            getCurrentPlayer: () => player,
            getConfig: () => Globals.config,
            things,
            gameLocations: locations,
            regions: new Map([[destinationRegion.id, destinationRegion]])
        });
        Events._handlers = {
            ...Events._handlers,
            scenery_appear: async function (_entries, context = {}) {
                arrivalPlayerLocations.push(context.player?.currentLocation || null);
                arrivalContextLocations.push(context.location?.id || null);
            }
        };

        await Events.runEventChecks({
            textToCheck: 'Baato carries the display screen to the main junction hub.',
            suppressMoveEvents: true,
            suppressTimeAdvance: true
        });

        assert.equal(destination.hasThing(display.id), true);
        assert.equal(origin.hasThing(display.id), false);
        assert.equal(display.metadata.locationId, destination.id);
        assert.equal(destination.hasThing(fern.id), true);
        assert.equal(origin.hasThing(fern.id), false);
        assert.equal(fern.metadata.locationId, destination.id);
        assert.deepEqual(arrivalContextLocations, [destination.id]);
        assert.deepEqual(arrivalPlayerLocations, [destination.id]);
        assert.equal(player.currentLocation, origin.id);
    } finally {
        Events._deps = previousDeps;
        Events._baseTimeout = previousTimeout;
        Events._parsers = previousParsers;
        Events._aggregators = previousAggregators;
        Events._handlers = previousHandlers;
        LLMClient.chatCompletion = previousChatCompletion;
        LLMClient.logPrompt = previousLogPrompt;
        Globals.config = previousConfig;
        Globals.currentPlayer = previousCurrentPlayer;
        Globals.processedMove = previousProcessedMove;
    }
});

test('XML runEventChecks suppresses in-motion vehicle destination moves but keeps elapsed time', async () => {
    const previousConfig = Globals.config;
    const previousCurrentPlayer = Globals.currentPlayer;
    const previousProcessedMove = Globals.processedMove;
    const previousAdvanceTime = Globals.advanceTime;
    const previousChatCompletion = LLMClient.chatCompletion;
    const previousLogPrompt = LLMClient.logPrompt;
    const previousDeps = Events._deps;
    const previousTimeout = Events._baseTimeout;
    const previousParsers = Events._parsers;
    const previousAggregators = Events._aggregators;
    const previousHandlers = Events._handlers;
    const vehicle = {
        id: 'vehicle',
        name: 'Outskirts Shuttle Bus',
        isVehicle: true,
        vehicleInfo: {
            isUnderway: true,
            hasArrived: false,
            pendingDestination: {
                locationId: 'dest',
                locationName: 'Main Street and Town Square',
                regionName: 'Atomville Main Street'
            }
        },
        things: []
    };
    const destination = {
        id: 'dest',
        name: 'Main Street and Town Square',
        things: []
    };
    const locations = new Map([
        ['vehicle', vehicle],
        ['Outskirts Shuttle Bus', vehicle],
        ['dest', destination],
        ['Main Street and Town Square', destination]
    ]);
    const player = {
        isNPC: false,
        currentLocation: 'vehicle',
        setLocation(locationId) {
            this.currentLocation = locationId;
        }
    };
    const timeAdvancements = [];

    try {
        Globals.config = {
            ai: {},
            event_checks: { enabled: true },
            quests: { enabled: false },
            omit_npc_generation: true
        };
        Globals.currentPlayer = player;
        Globals.processedMove = false;
        Globals.advanceTime = (minutes, options = {}) => {
            timeAdvancements.push({ minutes, source: options.source || null });
            return { advancedMinutes: minutes, source: options.source || null };
        };
        LLMClient.chatCompletion = async () => `<events>
  <moveLocation><destinationName>Main Street and Town Square</destinationName></moveLocation>
  <arriveAtLocation/>
  <timePassed><reasoning>The shuttle ride finished.</reasoning><duration>8 minutes</duration></timePassed>
</events>`;
        LLMClient.logPrompt = () => {};
        Events.initialize({
            promptEnv: {
                render: (_template, context) => JSON.stringify({ promptType: context.promptType })
            },
            parseXMLTemplate: (rendered) => ({
                systemPrompt: 'system',
                generationPrompt: rendered
            }),
            prepareBasePromptContext: async () => ({
                needBarDefinitions: [],
                npcs: [],
                party: []
            }),
            Location: {
                get: (reference) => locations.get(reference) || null,
                findByName: (name) => locations.get(name) || null,
                findShortestTravelTimeMinutes: () => {
                    throw new Error('vehicle destination suppression should not calculate route time');
                }
            },
            findRegionByLocationId: () => null,
            getCurrentPlayer: () => player,
            getConfig: () => Globals.config
        });

        const result = await Events.runEventChecks({
            textToCheck: 'The shuttle reaches Main Street.'
        });

        assert.equal(player.currentLocation, 'vehicle');
        assert.deepEqual(timeAdvancements, [
            { minutes: 8, source: 'event_check' }
        ]);
        assert.equal(result.timeProgress.advancedMinutes, 8);
        assert.equal(Globals.processedMove, false);
    } finally {
        Events._deps = previousDeps;
        Events._baseTimeout = previousTimeout;
        Events._parsers = previousParsers;
        Events._aggregators = previousAggregators;
        Events._handlers = previousHandlers;
        LLMClient.chatCompletion = previousChatCompletion;
        LLMClient.logPrompt = previousLogPrompt;
        Globals.advanceTime = previousAdvanceTime;
        Globals.config = previousConfig;
        Globals.currentPlayer = previousCurrentPlayer;
        Globals.processedMove = previousProcessedMove;
    }
});

test('XML runEventChecks suppressTimeAdvance suppresses movement and timePassed advancement', async () => {
    const previousConfig = Globals.config;
    const previousCurrentPlayer = Globals.currentPlayer;
    const previousProcessedMove = Globals.processedMove;
    const previousAdvanceTime = Globals.advanceTime;
    const previousChatCompletion = LLMClient.chatCompletion;
    const previousLogPrompt = LLMClient.logPrompt;
    const previousDeps = Events._deps;
    const previousTimeout = Events._baseTimeout;
    const previousParsers = Events._parsers;
    const previousAggregators = Events._aggregators;
    const previousHandlers = Events._handlers;
    const origin = { id: 'origin', name: 'Origin', things: [] };
    const destination = { id: 'dest', name: 'North Gate', things: [] };
    const locations = new Map([
        ['origin', origin],
        ['North Gate', destination],
        ['dest', destination]
    ]);
    const player = {
        isNPC: false,
        currentLocation: 'origin',
        setLocation(locationId) {
            this.currentLocation = locationId;
        }
    };
    const timeAdvancements = [];

    try {
        Globals.config = {
            ai: {},
            event_checks: { enabled: true },
            quests: { enabled: false },
            omit_npc_generation: true
        };
        Globals.currentPlayer = player;
        Globals.processedMove = false;
        Globals.advanceTime = (minutes, options = {}) => {
            timeAdvancements.push({ minutes, source: options.source || null });
            return { advancedMinutes: minutes, source: options.source || null };
        };
        LLMClient.chatCompletion = async () => `<events>
  <timePassed><reasoning>Preparing to go.</reasoning><duration>3 minutes</duration></timePassed>
  <moveLocation><destinationName>North Gate</destinationName></moveLocation>
  <arriveAtLocation/>
  <timePassed><reasoning>Looking around.</reasoning><duration>5 minutes</duration></timePassed>
</events>`;
        LLMClient.logPrompt = () => {};
        Events.initialize({
            promptEnv: {
                render: (_template, context) => JSON.stringify({ promptType: context.promptType })
            },
            parseXMLTemplate: (rendered) => ({
                systemPrompt: 'system',
                generationPrompt: rendered
            }),
            prepareBasePromptContext: async () => ({
                needBarDefinitions: [],
                npcs: [],
                party: []
            }),
            Location: {
                get: (reference) => locations.get(reference) || null,
                findByName: (name) => locations.get(name) || null,
                findShortestTravelTimeMinutes: () => 12
            },
            findRegionByLocationId: () => null,
            getCurrentPlayer: () => player,
            getConfig: () => Globals.config
        });

        await Events.runEventChecks({
            textToCheck: 'The player travels to the North Gate.',
            suppressTimeAdvance: true
        });

        assert.equal(player.currentLocation, 'dest');
        assert.deepEqual(timeAdvancements, []);
    } finally {
        Events._deps = previousDeps;
        Events._baseTimeout = previousTimeout;
        Events._parsers = previousParsers;
        Events._aggregators = previousAggregators;
        Events._handlers = previousHandlers;
        LLMClient.chatCompletion = previousChatCompletion;
        LLMClient.logPrompt = previousLogPrompt;
        Globals.advanceTime = previousAdvanceTime;
        Globals.config = previousConfig;
        Globals.currentPlayer = previousCurrentPlayer;
        Globals.processedMove = previousProcessedMove;
    }
});
