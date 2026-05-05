const test = require('node:test');
const assert = require('node:assert/strict');

const Events = require('../Events.js');
const Globals = require('../Globals.js');
const LLMClient = require('../LLMClient.js');

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
  <newExitDiscovered><destination><locationName>Hidden Garden</locationName><regionName>Hedge Maze</regionName></destination><destinationKind>location</destinationKind><vehicleType>none</vehicleType><description>A concealed garden path.</description><origin><locationName>Old Gatehouse</locationName><regionName>Castle Grounds</regionName></origin><travelTime>5 minutes</travelTime></newExitDiscovered>
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
  <npcArrivalDeparture><npcName>Ada</npcName><action>left</action><destinationRegion>Town</destinationRegion><destinationLocation>Market</destinationLocation></npcArrivalDeparture>
  <npcFirstAppearance><npcName>Mysterious Cat</npcName></npcFirstAppearance>
  <partyChange><npcName>Ada</npcName><action>joined</action></partyChange>
  <environmentalStatusDamage><actorName>Wanderer</actorName><effect>damage</effect><severity>medium</severity><reason>Smoke inhalation.</reason></environmentalStatusDamage>
  <healRecover><characterName>Wanderer</characterName><magnitude>small</magnitude><reason>Bandaged wounds</reason></healRecover>
  <hostileToFriendly><npcName>Guard</npcName><previousDisposition>hostile</previousDisposition><newDisposition>neutral</newDisposition><reason>Accepted apology.</reason></hostileToFriendly>
  <deathIncapacitation><actorName>Goblin</actorName><outcome>incapacitated</outcome></deathIncapacitation>
  <inCombat><value>true</value></inCombat>
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
        assert.equal(events.npc_arrival_departure[0].destinationLocation, 'Market');
        assert.deepEqual(events.party_change[0], { name: 'Ada', action: 'joined' });
        assert.equal(events.environmental_status_damage[0].effect, 'damage');
        assert.equal(events.heal_recover[0].character, 'Wanderer');
        assert.equal(events.hostile_to_friendly[0].newDisposition, 'neutral');
        assert.equal(events.death_incapacitation[0].status, 'incapacitated');
        assert.equal(events.in_combat, true);
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

test('XML newExitDiscovered preserves destination location when destination kind is region', () => {
    const parsed = Events._parseXmlEventCheckResponse(`
<events>
  <newExitDiscovered>
    <destination>
      <locationName>Gorge Trailhead</locationName>
      <regionName>Copperwheel Gorge</regionName>
    </destination>
    <destinationKind>region</destinationKind>
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

        assert.deepEqual(capturedPromptTypes.sort(), ['events-xml', 'need-bars'].sort());
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
