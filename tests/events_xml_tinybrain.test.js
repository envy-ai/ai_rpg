const test = require('node:test');
const assert = require('node:assert/strict');
const nunjucks = require('nunjucks');
const path = require('path');

const Events = require('../Events.js');
const Globals = require('../Globals.js');
const LLMClient = require('../LLMClient.js');
const {
    TinyBrainPromptExtension,
    createTinyBrainRenderState
} = require('../TinyBrainPromptRunner.js');
const { configureTinyBrainPromptContext } = require('../TinyBrainPromptFamilies.js');
const { buildBaseRenderContext } = require('./helpers/baseContextFixtures.js');

const PROMPTS_DIR = path.join(__dirname, '..', 'prompts');

function createEventsPromptEnv() {
    const env = nunjucks.configure(PROMPTS_DIR, { autoescape: false });
    env.addGlobal('randomword', () => 'test');
    env.addExtension('TinyBrainPromptExtension', new TinyBrainPromptExtension());
    return env;
}

function parseXMLTemplate(rendered) {
    const system = rendered.match(/<systemPrompt><!\[CDATA\[([\s\S]*?)\]\]><\/systemPrompt>/);
    const generation = rendered.match(/<generationPrompt><!\[CDATA\[([\s\S]*?)\]\]><\/generationPrompt>/);
    return {
        systemPrompt: system ? system[1] : null,
        generationPrompt: generation ? generation[1] : null
    };
}

function buildEventsContext(overrides = {}) {
    return {
        ...buildBaseRenderContext({}),
        promptType: 'events-xml',
        textToCheck: 'Exis picks up the lantern and hands Mira 5 credits.',
        omitGameHistory: true,
        currentLocation: { name: 'Test Location' },
        regionContext: { name: 'Test Region' },
        npcs: [],
        party: [],
        characterName: 'Exis',
        experiencePointValues: [],
        config: { soft_quest_limit: 10 },
        tinyBrainEventSectionKind: 'current',
        tinyBrainEventSectionLabel: 'CURRENT',
        eventCheckHiddenNpcNames: [],
        tinyBrainEventStages: Events._buildTinyBrainEventStages({ hiddenNpcNames: [] }),
        ...overrides
    };
}

test('stage manifest separates current, transit, tracker, and suppressed stages', () => {
    const current = Events._buildTinyBrainEventStages();
    assert.deepEqual(
        current.map((stage) => stage.id),
        ['scene', 'items', 'characters', 'combat', 'progression', 'final', 'trackers']
    );
    assert.ok(current.at(-2).allowedTags.includes('currency'));
    assert.ok(current.at(-2).allowedTags.includes('inCombat'));
    assert.equal(current.at(-1).allowedTagList, '<trackerUpdates>');
    assert.deepEqual(current.at(-2).requiredTags, [
        'inCombat',
        'anyQuestObjectivesCompleted'
    ]);

    const origin = Events._buildTinyBrainEventStages({
        eventSectionKind: 'origin',
        suppressTimeAdvance: true,
        suppressTrackerUpdates: true,
        ignoredEventKeys: ['currency']
    });
    assert.ok(origin.every((stage) => !stage.allowedTags.includes('trackerUpdates')));
    assert.ok(origin.every((stage) => !stage.allowedTags.includes('timePassed')));
    assert.ok(origin.every((stage) => !stage.allowedTags.includes('currency')));

    const between = Events._buildTinyBrainEventStages({
        eventSectionKind: 'between',
        suppressTrackerUpdates: true
    });
    assert.deepEqual(between.map((stage) => stage.id), ['transit', 'final']);
    assert.ok(between.every((stage) =>
        stage.allowedTags.length === 1 && stage.allowedTags[0] === 'thingMoveWithCharacter'
    ));

    const trackers = Events._buildTinyBrainEventStages({
        eventSectionKind: 'tracker',
        eventMode: 'trackers'
    });
    assert.deepEqual(trackers.map((stage) => stage.id), ['trackers']);

    const withoutHiddenNpc = Events._buildTinyBrainEventStages({
        hiddenNpcNames: []
    });
    assert.ok(withoutHiddenNpc.every((stage) =>
        !stage.allowedTags.includes('revealHiddenNpc')
    ));
    const withHiddenNpc = Events._buildTinyBrainEventStages({
        hiddenNpcNames: ['Veiled Scout']
    });
    assert.ok(withHiddenNpc.find((stage) => stage.id === 'characters')
        .allowedTags.includes('revealHiddenNpc'));
    assert.match(
        withHiddenNpc.find((stage) => stage.id === 'characters').instructions,
        /exact present hidden NPC names: Veiled Scout/
    );
    assert.match(
        withoutHiddenNpc.find((stage) => stage.id === 'characters').instructions,
        /use npcFirstAppearance when the prose reveals a hidden NPC.*name or alias.*revealed instead of duplicated/i
    );
});

test('event checks derive exact living hidden NPC names from the current location', () => {
    const names = Events._getEventCheckHiddenNpcNames({
        getNPCs: () => [
            { name: 'Veiled Scout', isNPC: true, isDead: false, hiddenFromPlayer: true },
            { name: 'Visible Courier', isNPC: true, isDead: false, hiddenFromPlayer: false },
            { name: 'Hidden Corpse', isNPC: true, isDead: true, hiddenFromPlayer: true },
            { name: 'Veiled Scout', isNPC: true, isDead: false, hiddenFromPlayer: true }
        ]
    });

    assert.deepEqual(names, ['Veiled Scout']);
});

test('tiny-brain event stage parser validates allowlists, semantics, trackers, and duplicates', () => {
    const done = Events.parseTinyBrainEventXmlStage('<done/>', {
        stageId: 'items',
        allowedTags: ['currency']
    });
    assert.equal(done.value.xml, '');

    const wrappedDone = Events.parseTinyBrainEventXmlStage(
        '<events><done/></events>',
        { stageId: 'items', allowedTags: ['currency'] }
    );
    assert.equal(wrappedDone.value.xml, '');
    assert.deepEqual(wrappedDone.value.signatures, []);

    const ignoredMove = Events.parseTinyBrainEventXmlStage(
        '<events><moveLocation><destinationName>Town Square</destinationName></moveLocation><arriveAtLocation/></events>',
        { stageId: 'scene', allowedTags: ['alterLocation'] }
    );
    assert.equal(ignoredMove.value.xml, '');
    assert.deepEqual(ignoredMove.value.signatures, []);
    assert.throws(
        () => Events.parseTinyBrainEventXmlStage(
            '<events><moveLocation><destinationName>Town Square</destinationName></moveLocation><arriveAtLocation/></events>',
            {
                stageId: 'final',
                allowedTags: ['inCombat'],
                requiredTags: ['inCombat']
            }
        ),
        /must include required tags: inCombat/
    );

    const ignoredNewMoveAlongsideEvent = Events.parseTinyBrainEventXmlStage(
        '<events><moveNewLocation><destinationName>New Square</destinationName></moveNewLocation><currency><amount>5</amount></currency><arriveAtLocation/></events>',
        { stageId: 'items', allowedTags: ['currency'] }
    );
    assert.doesNotMatch(ignoredNewMoveAlongsideEvent.value.xml, /moveNewLocation|arriveAtLocation/);
    assert.match(ignoredNewMoveAlongsideEvent.value.xml, /<currency>/);

    const currency = Events.parseTinyBrainEventXmlStage(
        '<events><currency><amount>5</amount></currency></events>',
        { stageId: 'items', allowedTags: ['currency'] }
    );
    assert.match(currency.value.xml, /<currency>/);
    assert.equal(currency.value.signatures.length, 1);

    const redundantCompanionArrival = Events.parseTinyBrainEventXmlStage(
        '<events><npcArrival><npcName>Rika the Gazer</npcName><hideFromPlayer>false</hideFromPlayer></npcArrival></events>',
        {
            sectionKind: 'destination',
            stageId: 'characters',
            allowedTags: ['npcArrival'],
            authoritativeMovementCompanionNames: ['Rika the Gazer']
        }
    );
    assert.equal(redundantCompanionArrival.value.xml, '');
    assert.deepEqual(redundantCompanionArrival.value.signatures, []);
    const unrelatedArrival = Events.parseTinyBrainEventXmlStage(
        '<events><npcArrival><npcName>Station Porter</npcName><hideFromPlayer>false</hideFromPlayer></npcArrival></events>',
        {
            sectionKind: 'destination',
            stageId: 'characters',
            allowedTags: ['npcArrival'],
            authoritativeMovementCompanionNames: ['Rika the Gazer']
        }
    );
    assert.match(unrelatedArrival.value.xml, /<npcArrival>/);

    assert.throws(
        () => Events.parseTinyBrainEventXmlStage(
            '<events><currency><amount>5</amount></currency></events>',
            { stageId: 'scene', allowedTags: ['alterLocation'] }
        ),
        /does not allow <currency>/
    );
    assert.throws(
        () => Events.parseTinyBrainEventXmlStage(
            '<events><pickUpItem><fullItemName>Lantern</fullItemName><quantity>1</quantity></pickUpItem></events>',
            { stageId: 'items', allowedTags: ['pickUpItem'] }
        ),
        /requires a non-empty <actorName>/
    );
    const repeatedCurrency = Events.parseTinyBrainEventXmlStage(
        '<events><currency><amount>5</amount></currency></events>',
        {
            stageId: 'final',
            allowedTags: ['currency'],
            acceptedSignatures: currency.value.signatures
        }
    );
    assert.equal(repeatedCurrency.value.xml, '');
    assert.deepEqual(repeatedCurrency.value.signatures, []);
    const warnings = [];
    const originalWarn = console.warn;
    console.warn = (...args) => warnings.push(args.join(' '));
    try {
        const ignoredUnknown = Events.parseTinyBrainEventXmlStage(
            '<events><updateTracker><trackerName>Alarm</trackerName></updateTracker></events>',
            { sectionKind: 'tracker', stageId: 'trackers', allowedTags: ['trackerUpdates'] }
        );
        assert.equal(ignoredUnknown.value.xml, '');

        assert.throws(
            () => Events.parseTinyBrainEventXmlStage(
                '<events><in_combat><value>false</value></in_combat><anyQuestObjectivesCompleted><value>false</value></anyQuestObjectivesCompleted></events>',
                {
                    stageId: 'final',
                    allowedTags: ['inCombat', 'anyQuestObjectivesCompleted'],
                    requiredTags: ['inCombat', 'anyQuestObjectivesCompleted']
                }
            ),
            /missing required tags: inCombat/
        );
    } finally {
        console.warn = originalWarn;
    }
    assert.deepEqual(warnings, [
        'Ignoring unknown event XML tag <updateTracker>.',
        'Ignoring unknown event XML tag <in_combat>.'
    ]);

    const tracker = Events.parseTinyBrainEventXmlStage(
        '<events><trackerUpdates><trackerUpdate><trackerName>Alarm</trackerName><type>numerical_count</type><action>add</action><newValue>2</newValue><reason>Two guards remain.</reason></trackerUpdate></trackerUpdates></events>',
        { sectionKind: 'tracker', stageId: 'trackers', allowedTags: ['trackerUpdates'] }
    );
    assert.match(tracker.value.xml, /<trackerUpdates>/);

    const bareTracker = Events.parseTinyBrainEventXmlStage(
        '<trackerUpdates><trackerUpdate><trackerName>Alarm</trackerName><type>numerical_count</type><action>add</action><newValue>2</newValue><reason>Two guards remain.</reason></trackerUpdate></trackerUpdates>',
        { sectionKind: 'tracker', stageId: 'trackers', allowedTags: ['trackerUpdates'] }
    );
    assert.match(bareTracker.value.xml, /^<trackerUpdates>/);

    const bareCurrency = Events.parseTinyBrainEventXmlStage(
        '<currency><amount>5</amount></currency>',
        { stageId: 'items', allowedTags: ['currency'] }
    );
    assert.match(bareCurrency.value.xml, /^<currency>/);

    assert.throws(
        () => Events.parseTinyBrainEventXmlStage(
            '<currency><amount>5</amount></currency>',
            { stageId: 'scene', allowedTags: ['alterLocation'] }
        ),
        /missing <events> block/
    );
    assert.throws(
        () => Events.parseTinyBrainEventXmlStage(
            '<events><trackerUpdates></trackerUpdates></events>',
            { sectionKind: 'tracker', stageId: 'trackers', allowedTags: ['trackerUpdates'] }
        ),
        /must contain at least one/
    );
    assert.throws(
        () => Events.parseTinyBrainEventXmlStage('<done/>', {
            stageId: 'final',
            allowedTags: ['inCombat', 'anyQuestObjectivesCompleted'],
            requiredTags: ['inCombat', 'anyQuestObjectivesCompleted']
        }),
        /must include required tags/
    );
    assert.throws(
        () => Events.parseTinyBrainEventXmlStage('<events><done/></events>', {
            stageId: 'final',
            allowedTags: ['inCombat', 'anyQuestObjectivesCompleted'],
            requiredTags: ['inCombat', 'anyQuestObjectivesCompleted']
        }),
        /must include required tags/
    );
    assert.throws(
        () => Events.parseTinyBrainEventXmlStage(
            '<events><done/><currency><amount>5</amount></currency></events>',
            { stageId: 'items', allowedTags: ['currency'] }
        ),
        /only as the sole empty child/
    );
    assert.throws(
        () => Events.parseTinyBrainEventXmlStage(
            '<events><done reason="none"/></events>',
            { stageId: 'items', allowedTags: ['currency'] }
        ),
        /only as the sole empty child/
    );
});

test('tiny-brain event stage parser rejects empty and malformed responses', () => {
    assert.throws(
        () => Events.parseTinyBrainEventXmlStage('<events></events>', {
            stageId: 'items',
            allowedTags: ['currency']
        }),
        /no event elements/
    );
    assert.throws(
        () => Events.parseTinyBrainEventXmlStage('<events><currency></events>', {
            stageId: 'items',
            allowedTags: ['currency']
        }),
        /Failed to parse/
    );
    assert.throws(
        () => Events.parseTinyBrainEventXmlStage('   ', {
            stageId: 'items',
            allowedTags: ['currency']
        }),
        /non-whitespace/
    );
});

test('tiny-brain reveal events require an exact present hidden NPC name', () => {
    const previousDeps = Events._deps;
    const visibleCourier = {
        id: 'npc-courier',
        name: 'Visible Courier',
        isNPC: true,
        hiddenFromPlayer: false
    };
    const hiddenScout = {
        id: 'npc-scout',
        name: 'Veiled Scout',
        isNPC: true,
        hiddenFromPlayer: true
    };
    Events._deps = {
        ...previousDeps,
        findActorByName: (name) => {
            const normalized = String(name || '').trim().toLowerCase();
            if (normalized === visibleCourier.name.toLowerCase()) return visibleCourier;
            if (normalized === hiddenScout.name.toLowerCase()) return hiddenScout;
            return null;
        }
    };

    const revealXml = (name) => `<events><revealHiddenNpc><npcName>${name}</npcName><description>They step into view.</description><useOpposedCheck>false</useOpposedCheck></revealHiddenNpc></events>`;

    try {
        assert.throws(
            () => Events.parseTinyBrainEventXmlStage(revealXml('Nyx'), {
                stageId: 'characters',
                allowedTags: ['npcFirstAppearance', 'npcArrival'],
                hiddenNpcNames: []
            }),
            /NPC "Nyx" does not exist in the game data.*<npcFirstAppearance>.*<npcArrival>.*no present hidden NPCs/
        );
        assert.throws(
            () => Events.parseTinyBrainEventXmlStage(revealXml('Visible Courier'), {
                stageId: 'characters',
                allowedTags: ['revealHiddenNpc', 'npcFirstAppearance', 'npcArrival'],
                hiddenNpcNames: ['Veiled Scout']
            }),
            /not listed as present and hidden.*exact present hidden NPC names are: Veiled Scout/
        );

        const accepted = Events.parseTinyBrainEventXmlStage(revealXml('Veiled Scout'), {
            stageId: 'characters',
            allowedTags: ['revealHiddenNpc'],
            hiddenNpcNames: ['Veiled Scout']
        });
        assert.match(accepted.value.xml, /<npcName>Veiled Scout<\/npcName>/);
    } finally {
        Events._deps = previousDeps;
    }
});

test('tiny-brain thing arrival duplicates are safely suppressed for owned and contained things', () => {
    const previousDeps = Events._deps;
    const owner = { id: 'char_player', name: 'Baato' };
    const satchel = {
        id: 'thing_satchel',
        name: 'QA Satchel',
        metadata: { ownerId: owner.id },
        whoseInventory: () => [owner],
    };
    const carriedCase = {
        id: 'thing_case',
        name: 'QA Brass Travel Case',
        metadata: { ownerId: owner.id },
        whoseInventory: () => [owner],
    };
    const sceneCrate = {
        id: 'thing_crate',
        name: 'QA Supply Crate',
        metadata: { locationId: 'loc_origin' },
        whoseInventory: () => [],
    };
    const containedChip = {
        id: 'thing_chip',
        name: 'QA Contained Chip',
        metadata: { containerId: satchel.id },
        whoseInventory: () => [],
        whoseContainer: () => [satchel],
    };
    const things = new Map([
        [carriedCase.id, carriedCase],
        [sceneCrate.id, sceneCrate],
        [containedChip.id, containedChip],
        [satchel.id, satchel],
    ]);
    Events._deps = {
        ...previousDeps,
        things,
        findThingByName: (name) => Array.from(things.values()).find(
            (thing) => thing.name === name,
        ) || null,
        findActorById: (id) => id === owner.id ? owner : null,
    };

    try {
        const ownedArrival = Events.parseTinyBrainEventXmlStage(
            '<events><thingArrival><thingName>QA Brass Travel Case</thingName></thingArrival></events>',
            {
                sectionKind: 'destination',
                stageId: 'scene',
                allowedTags: ['thingArrival'],
                eventLocation: { id: 'loc_destination' },
            },
        );
        assert.equal(ownedArrival.value.xml, '');
        assert.deepEqual(ownedArrival.value.signatures, []);

        const containedArrival = Events.parseTinyBrainEventXmlStage(
            '<events><thingArrival><thingName>QA Contained Chip</thingName></thingArrival></events>',
            {
                sectionKind: 'destination',
                stageId: 'scene',
                allowedTags: ['thingArrival'],
                eventLocation: { id: 'loc_destination' },
            },
        );
        assert.equal(containedArrival.value.xml, '');
        assert.deepEqual(containedArrival.value.signatures, []);

        const legitimateArrival = Events.parseTinyBrainEventXmlStage(
            '<events><thingArrival><thingName>QA Supply Crate</thingName></thingArrival></events>',
            {
                sectionKind: 'destination',
                stageId: 'scene',
                allowedTags: ['thingArrival'],
                eventLocation: { id: 'loc_destination' },
            },
        );
        assert.match(legitimateArrival.value.xml, /<thingArrival>/);
    } finally {
        Events._deps = previousDeps;
    }
});

test('tiny-brain event stage parser requires a persistent outcome for zero-health defeated enemies', () => {
    const previousDeps = Events._deps;
    const frostSlug = {
        name: 'Frost Slug',
        health: 0,
        isDead: false
    };
    Events._deps = {
        ...previousDeps,
        findActorByName: (name) => name === frostSlug.name ? frostSlug : null
    };

    try {
        assert.throws(
            () => Events.parseTinyBrainEventXmlStage(
                '<events><defeatedEnemy><enemyName>Frost Slug</enemyName></defeatedEnemy></events>',
                {
                    stageId: 'combat',
                    allowedTags: ['deathIncapacitation', 'defeatedEnemy']
                }
            ),
            /without a matching <deathIncapacitation>/
        );

        const resolvedTogether = Events.parseTinyBrainEventXmlStage(
            '<events><deathIncapacitation><actorName>Frost Slug</actorName><outcome>dead</outcome></deathIncapacitation><defeatedEnemy><enemyName>Frost Slug</enemyName></defeatedEnemy></events>',
            {
                stageId: 'combat',
                allowedTags: ['deathIncapacitation', 'defeatedEnemy']
            }
        );
        assert.deepEqual(resolvedTogether.value.deathOutcomeNames, ['frost slug']);

        const resolvedEarlier = Events.parseTinyBrainEventXmlStage(
            '<events><defeatedEnemy><enemyName>Frost Slug</enemyName></defeatedEnemy></events>',
            {
                stageId: 'final',
                allowedTags: ['defeatedEnemy'],
                acceptedDeathOutcomeNames: ['Frost Slug']
            }
        );
        assert.match(resolvedEarlier.value.xml, /<defeatedEnemy>/);

        frostSlug.health = 4;
        const nonHealthDefeat = Events.parseTinyBrainEventXmlStage(
            '<events><defeatedEnemy><enemyName>Frost Slug</enemyName></defeatedEnemy></events>',
            {
                stageId: 'combat',
                allowedTags: ['defeatedEnemy']
            }
        );
        assert.match(nonHealthDefeat.value.xml, /<defeatedEnemy>/);
    } finally {
        Events._deps = previousDeps;
    }
});

test('tiny-brain event stage parser suppresses status changes already satisfied by current actor state', () => {
    const previousDeps = Events._deps;
    const wanderer = {
        name: 'Wanderer',
        getStatusEffects: () => [{
            name: 'Burnt',
            description: 'Charred skin and singed clothing.'
        }]
    };
    Events._deps = {
        ...previousDeps,
        findActorByName: (name) => name === wanderer.name ? wanderer : null
    };

    try {
        const duplicateGain = Events.parseTinyBrainEventXmlStage(
            '<events><statusEffectChange><entityName>Wanderer</entityName><statusEffectName>Burnt</statusEffectName><action>gained</action></statusEffectChange></events>',
            { stageId: 'characters', allowedTags: ['statusEffectChange'] }
        );
        assert.equal(duplicateGain.value.xml, '');

        const loss = Events.parseTinyBrainEventXmlStage(
            '<events><statusEffectChange><entityName>Wanderer</entityName><statusEffectName>Burnt</statusEffectName><action>lost</action></statusEffectChange></events>',
            { stageId: 'characters', allowedTags: ['statusEffectChange'] }
        );
        assert.match(loss.value.xml, /<statusEffectChange>/);

        const duplicateLoss = Events.parseTinyBrainEventXmlStage(
            '<events><statusEffectChange><entityName>Wanderer</entityName><statusEffectName>Poisoned</statusEffectName><action>lost</action></statusEffectChange></events>',
            { stageId: 'characters', allowedTags: ['statusEffectChange'] }
        );
        assert.equal(duplicateLoss.value.xml, '');

        const gain = Events.parseTinyBrainEventXmlStage(
            '<events><statusEffectChange><entityName>Wanderer</entityName><statusEffectName>Poisoned</statusEffectName><action>gained</action></statusEffectChange></events>',
            { stageId: 'characters', allowedTags: ['statusEffectChange'] }
        );
        assert.match(gain.value.xml, /<statusEffectChange>/);
    } finally {
        Events._deps = previousDeps;
    }
});

test('tiny-brain status stage suppresses a renamed duplicate of an accepted authoritative item effect', () => {
    const previousDeps = Events._deps;
    const actor = {
        name: 'Baato',
        isDead: false,
        statusEffects: [],
    };
    const item = {
        name: 'QA Focus Draught',
        causeStatusEffectOnTarget: {
            name: 'QA Focused',
            description: 'A sharp, clear-headed sensation from a test draught.',
            duration: 5,
        },
    };

    Events._deps = {
        ...previousDeps,
        findActorByName: (name) => name === actor.name ? actor : null,
        findThingByName: (name) => name === item.name ? item : null,
    };

    try {
        const acceptedItemStage = {
            1: {
                value: {
                    xml: '<itemIngest><fullItemName>QA Focus Draught</fullItemName><consumerName>Baato</consumerName></itemIngest>',
                },
            },
        };
        const applications = Events._collectTinyBrainAcceptedItemStatusApplications(
            acceptedItemStage,
        );
        assert.deepEqual(applications, [{
            targetName: 'Baato',
            itemName: 'QA Focus Draught',
            effectName: 'QA Focused',
            effectDescription: 'A sharp, clear-headed sensation from a test draught.',
            sourceTag: 'itemIngest',
        }]);

        const duplicateItemEffect = Events.parseTinyBrainEventXmlStage(
            '<events><statusEffectChange><entityName>Baato</entityName><statusEffectName>QA Focus Draught effect</statusEffectName><action>gained</action><level>1</level></statusEffectChange></events>',
            {
                stageId: 'characters',
                allowedTags: ['statusEffectChange'],
                acceptedItemStatusApplications: applications,
            },
        );
        assert.equal(duplicateItemEffect.value.xml, '');
        assert.deepEqual(duplicateItemEffect.value.signatures, []);

        const independent = Events.parseTinyBrainEventXmlStage(
            '<events><statusEffectChange><entityName>Baato</entityName><statusEffectName>Chilled</statusEffectName><action>gained</action><level>1</level></statusEffectChange></events>',
            {
                stageId: 'characters',
                allowedTags: ['statusEffectChange'],
                acceptedItemStatusApplications: applications,
            },
        );
        assert.match(
            independent.value.xml,
            /<statusEffectName>Chilled<\/statusEffectName>/,
        );
    } finally {
        Events._deps = previousDeps;
    }
});

test('tiny-brain event stage parser rejects healing and new effects on dead actors', () => {
    const previousDeps = Events._deps;
    const corpse = {
        name: 'Frost Slug',
        health: 0,
        isDead: true,
        getStatusEffects: () => [{ name: 'Deceased', description: 'Deceased' }]
    };
    Events._deps = {
        ...previousDeps,
        findActorByName: (name) => name === corpse.name ? corpse : null
    };

    try {
        const deadTargetCases = [
            {
                xml: '<events><itemInflict><fullItemName>Bandage</fullItemName><targetName>Frost Slug</targetName><statusEffect>Useless</statusEffect></itemInflict></events>',
                options: { stageId: 'items', allowedTags: ['itemInflict'] },
                tag: 'itemInflict'
            },
            {
                xml: '<events><itemIngest><fullItemName>Tonic</fullItemName><consumerName>Frost Slug</consumerName></itemIngest></events>',
                options: { stageId: 'items', allowedTags: ['itemIngest'] },
                tag: 'itemIngest'
            },
            {
                xml: '<events><healRecover><characterName>Frost Slug</characterName><magnitude>small</magnitude><reason>Bandaged</reason></healRecover></events>',
                options: { stageId: 'combat', allowedTags: ['healRecover'] },
                tag: 'healRecover'
            },
            {
                xml: '<events><environmentalStatusDamage><actorName>Frost Slug</actorName><effect>healing</effect><severity>low</severity><reason>Warm light</reason></environmentalStatusDamage></events>',
                options: {
                    stageId: 'combat',
                    allowedTags: ['environmentalStatusDamage']
                },
                tag: 'environmentalStatusDamage'
            },
            {
                xml: '<events><statusEffectChange><entityName>Frost Slug</entityName><statusEffectName>Restored</statusEffectName><action>gained</action></statusEffectChange></events>',
                options: { stageId: 'characters', allowedTags: ['statusEffectChange'] },
                tag: 'status'
            }
        ];

        for (const entry of deadTargetCases) {
            assert.throws(
                () => Events.parseTinyBrainEventXmlStage(entry.xml, entry.options),
                new RegExp(`cannot (?:use <${entry.tag}> on|gain ${entry.tag})?.*dead actor|dead actor`)
            );
        }
    } finally {
        Events._deps = previousDeps;
    }
});

test('tiny-brain item stage rejects consume-plus-container quantities beyond authoritative stock', () => {
    const previousDeps = Events._deps;
    const tonic = { name: 'QA Focus Draught', count: 1, metadata: { count: 1 } };
    Events._deps = {
        ...previousDeps,
        findThingByName: (name) => name.toLowerCase() === tonic.name.toLowerCase()
            ? tonic
            : null,
    };

    const response = `<events>
<consumeItem><fullItemName>QA Focus Draught</fullItemName><quantity>1</quantity><reason>Drank it</reason></consumeItem>
<putItemInContainer><character>Baato</character><fullItemName>QA Focus Draught</fullItemName><quantity>1</quantity><containerName>Satchel</containerName></putItemInContainer>
</events>`;

    try {
        assert.throws(
            () => Events.parseTinyBrainEventXmlStage(response, {
                stageId: 'items',
                allowedTags: ['consumeItem', 'putItemInContainer'],
            }),
            /cannot consume 1 and put 1 .* when only 1 exists/,
        );

        tonic.count = 2;
        tonic.metadata.count = 2;
        const parsed = Events.parseTinyBrainEventXmlStage(response, {
            stageId: 'items',
            allowedTags: ['consumeItem', 'putItemInContainer'],
        });
        assert.match(parsed.value.xml, /<consumeItem>/);
        assert.match(parsed.value.xml, /<putItemInContainer>/);
    } finally {
        Events._deps = previousDeps;
    }
});

test('events tiny-brain template registers category checkpoints and local result builder', () => {
    const env = createEventsPromptEnv();
    const ctx = buildEventsContext({
        tinyBrainAuthoritativeMovementCompanionNames: ['Rika the Gazer']
    });
    const templateContext = { ...ctx };
    const tinyBrain = configureTinyBrainPromptContext(templateContext, 'event_checks');
    const state = tinyBrain.renderState;
    const full = env.render('base-context.xml.njk', templateContext);

    assert.ok(full.includes(state.programStartMarker), 'program start marker missing');
    assert.equal(state.checkpoints.length, 7);
    assert.equal(state.resultMarkers.length, 1);
    assert.equal(state.resultMarkers[0].builderName, 'event_xml_result');
    for (const checkpoint of state.checkpoints) {
        assert.equal(checkpoint.kind, 'parse');
        assert.equal(checkpoint.parserName, 'event_xml_stage');
        assert.equal(checkpoint.parserArgs[0], 'current');
        assert.deepEqual(checkpoint.parserArgs[5], []);
    }
    assert.deepEqual(
        state.checkpoints.map((checkpoint) => checkpoint.parserArgs[1]),
        ['scene', 'items', 'characters', 'combat', 'progression', 'final', 'trackers']
    );
    assert.match(full, /# Events XML Event Schema/, 'schema include missing');
    assert.match(full, /<activeQuestCount>0<\/activeQuestCount>/);
    assert.match(full, /<softQuestLimit>10<\/softQuestLimit>/);
    assert.match(full, /<trackerUpdates>/, 'tracker schema should be documented');
    assert.doesNotMatch(
        full,
        /<moveLocation>|<moveNewLocation>|<arriveAtLocation\s*\/>|## Travel Boundary/,
        'staged schema must not document movement XML owned by player-action parsing'
    );
    assert.match(
        full,
        /Player and party movement is handled by the prose response and must not be emitted during event extraction/,
        'staged schema must explain that movement is handled before event extraction'
    );
    assert.doesNotMatch(
        full,
        /### `(?:in_combat|anyQuestObjectivesCompleted)` \(REQUIRED FIELD, 1x ONLY\)/,
        'staged schema must not present final-checkpoint fields as globally required'
    );
    assert.match(
        full,
        /A tag is required only when the current checkpoint explicitly lists it/,
        'checkpoint-local required-field instruction missing'
    );
    assert.match(
        full,
        /do not emit `<inCombat>` or `<anyQuestObjectivesCompleted>` before that checkpoint/,
        'final state flags must be forbidden before their checkpoint'
    );
    assert.match(
        full,
        /If there are none, return exactly `<events><done\/><\/events>`/,
        'empty checkpoint response must use the explicit events wrapper'
    );
    assert.match(
        full,
        /defeatedEnemy alone does not resolve the actor's persistent condition/,
        'zero-health enemy defeats must request an explicit persistent outcome'
    );
    assert.match(
        full,
        /absent from Characters at location is not represented at this location in game data[\s\S]*npcFirstAppearance[\s\S]*npcArrival/,
        'character-presence stage must distinguish new NPC creation from arrivals'
    );
    assert.match(
        full,
        /A plan, memory, dialogue mention, or offscreen action alone is not physical presence/,
        'character-presence stage must not turn mere references into arrivals'
    );
    assert.match(
        full,
        /recovery path when the prose reveals a hidden NPC.*name or alias.*no duplicate is generated/i,
        'first appearances must recover hidden NPCs omitted from prompt data'
    );
    assert.match(full, /drops, places, or sets down an inventory item into the current scene/);
    assert.doesNotMatch(full, /reveal_hidden_npc|<revealHiddenNpc>/);
    assert.doesNotMatch(full, /exact present hidden NPC names/);
    assert.doesNotMatch(full, /authoritative player-movement companions for this turn/);
    assert.doesNotMatch(full, /Do not write any XML in this first step/);

    const marker = state.programStartMarker;
    const generationPrompt = parseXMLTemplate(full).generationPrompt;
    const programInFull = generationPrompt.slice(generationPrompt.indexOf(marker) + marker.length);
    const state2 = createTinyBrainRenderState();
    const standalone = env.render('_includes/events-xml.tinybrain.njk', {
        ...ctx,
        __tinyBrainState: state2
    });
    const markerPattern = /\[\[TINYBRAIN_(?:CHECKPOINT|RESULT):[a-f0-9-]+:/g;
    assert.equal(
        programInFull.replace(markerPattern, '[[TINYBRAIN_MARKER:').trimEnd(),
        standalone.replace(markerPattern, '[[TINYBRAIN_MARKER:').trimEnd()
    );
});

test('base-context render without the tiny-brain flag keeps the monolithic events template', () => {
    const env = createEventsPromptEnv();
    const ctx = buildEventsContext();
    const state = createTinyBrainRenderState();
    const rendered = env.render('base-context.xml.njk', {
        ...ctx,
        __tinyBrainState: state
    });

    assert.equal(state.checkpoints.length, 0);
    assert.match(rendered, /Output only one `<events>\.\.\.<\/events>` XML block/);
    assert.match(rendered, /<trackerUpdates>/);
    assert.doesNotMatch(
        rendered,
        /<moveLocation>|<moveNewLocation>|<arriveAtLocation\s*\/>|## Travel Boundary/,
        'monolithic event schema must not document movement XML owned by prose parsing'
    );
    assert.match(
        rendered,
        /Player and party movement is handled by the prose response and must not be emitted during event extraction/,
        'monolithic schema must explain that prose parsing owns movement'
    );
    assert.match(rendered, /### `in_combat` \(REQUIRED FIELD, 1x ONLY\)/);
    assert.match(rendered, /### `anyQuestObjectivesCompleted` \(REQUIRED FIELD, 1x ONLY\)/);
    assert.doesNotMatch(rendered, /reveal_hidden_npc|<revealHiddenNpc>/);
});

test('tiny-brain event stages include the exterior warning from current-location context', () => {
    const env = createEventsPromptEnv();
    const state = createTinyBrainRenderState();
    const rendered = env.render('_includes/events-xml.tinybrain.njk', {
        ...buildEventsContext({
            currentLocation: {
                name: 'Moon Gate',
                isExterior: true
            }
        }),
        __tinyBrainState: state
    });

    assert.match(rendered, /IMPORTANT NOTE: This is an exterior location\./);
});

test('event prompt lists exact present hidden NPCs and enables reveal guidance only then', () => {
    const env = createEventsPromptEnv();
    const hiddenNpcNames = ['Veiled Scout', 'Hidden Archer'];
    const ctx = buildEventsContext({
        eventCheckHiddenNpcNames: hiddenNpcNames,
        tinyBrainEventStages: Events._buildTinyBrainEventStages({ hiddenNpcNames })
    });
    const templateContext = { ...ctx };
    const tinyBrain = configureTinyBrainPromptContext(templateContext, 'event_checks');
    const rendered = env.render('base-context.xml.njk', templateContext);

    assert.match(rendered, /exact present hidden NPC names: Veiled Scout, Hidden Archer/);
    assert.match(rendered, /- Veiled Scout/);
    assert.match(rendered, /- Hidden Archer/);
    assert.match(rendered, /### `reveal_hidden_npc`/);
    assert.match(rendered, /<revealHiddenNpc>/);
    assert.deepEqual(
        tinyBrain.renderState.checkpoints.find((checkpoint) =>
            checkpoint.parserArgs[1] === 'characters'
        ).parserArgs[5],
        hiddenNpcNames
    );
});

test('staged tiny-brain run retries one malformed checkpoint and assembles validated XML locally', async () => {
    const previousConfig = Globals.config;
    const previousChatCompletion = LLMClient.chatCompletion;
    const previousLogPrompt = LLMClient.logPrompt;
    const previousWithPromptProgressGroup = LLMClient.withPromptProgressGroup;
    const previousClearPromptProgressGroup = LLMClient.clearPromptProgressGroup;

    const env = createEventsPromptEnv();
    const ctx = buildEventsContext();
    const templateContext = { ...ctx };
    const tinyBrain = configureTinyBrainPromptContext(templateContext, 'event_checks');
    const state = tinyBrain.renderState;
    const rendered = env.render('base-context.xml.njk', templateContext);

    const script = [
        '<done/>',
        '<events><pickUpItem><actorName>Exis</actorName><fullItemName>Lantern</fullItemName><quantity>1</quantity></pickUpItem><currency><amount>5</amount></currency></events>',
        '<done/>',
        '<done/>',
        '<done/>',
        '<events><inCombat><value>false</value></inCombat><anyQuestObjectivesCompleted><value>false</value></anyQuestObjectivesCompleted></events>',
        '<events><currency><amount>3</amount></currency></events>',
        '<done/>'
    ];
    let calls = 0;
    const progressGroups = [];
    const clearedProgressGroups = [];
    Globals.config = { ai: { retryAttempts: 1 } };
    LLMClient.chatCompletion = async () => script[Math.min(calls++, script.length - 1)];
    LLMClient.logPrompt = () => '/tmp/tinybrain-events-test.log';
    LLMClient.withPromptProgressGroup = async (options, callback) => {
        progressGroups.push(options);
        return await callback();
    };
    LLMClient.clearPromptProgressGroup = (progressGroupId, options) => {
        clearedProgressGroups.push({ progressGroupId, options });
    };

    try {
        const assembled = await Events._runTinyBrainEventXmlPrompt({
            initialRenderedTemplate: rendered,
            templateContext,
            tinyBrain,
            promptEnv: env,
            parseXMLTemplate
        });

        assert.equal(calls, 8, 'seven stages plus one tracker-stage retry');
        assert.deepEqual(progressGroups, [{
            progressGroupId: state.runId,
            progressGroupTargetLabel: 'event_checks_tinybrain'
        }]);
        assert.deepEqual(clearedProgressGroups, [{
            progressGroupId: state.runId,
            options: { recordOutputCharacters: true }
        }]);
        assert.match(assembled, /^<events>/);
        assert.match(assembled, /<pickUpItem>/);
        assert.match(assembled, /<currency>/);
        assert.match(assembled, /<inCombat>/);
        assert.doesNotMatch(assembled, /updateTracker/);

        const parsed = Events._parseXmlEventCheckResponse(assembled, {});
        assert.equal(parsed.structured.parsed.currency, 5);
        assert.equal(parsed.structured.parsed.in_combat, false);
    } finally {
        Globals.config = previousConfig;
        LLMClient.chatCompletion = previousChatCompletion;
        LLMClient.logPrompt = previousLogPrompt;
        LLMClient.withPromptProgressGroup = previousWithPromptProgressGroup;
        LLMClient.clearPromptProgressGroup = previousClearPromptProgressGroup;
    }
});

test('event sequence carries accepted section responses into the next section transcript and log', { concurrency: false }, async () => {
    const previousConfig = Globals.config;
    const previousChatCompletion = LLMClient.chatCompletion;
    const previousLogPrompt = LLMClient.logPrompt;
    const env = createEventsPromptEnv();
    const eventSequence = Events.createTinyBrainEventSequence();
    const completionMessages = [];
    const providerMessages = [];
    const logCalls = [];
    const logFilePath = '/tmp/tinybrain-events-sequence.log';
    const scriptedResponses = [
        '<events><currency><amount>5</amount></currency></events>',
        '<events><done/></events>',
        '<events><done/></events>'
    ];
    let responseIndex = 0;

    const runSection = async (sectionKind) => {
        const templateContext = buildEventsContext({
            textToCheck: `${sectionKind} prose.`,
            tinyBrainEventSectionKind: sectionKind,
            tinyBrainEventSectionLabel: sectionKind.toUpperCase(),
            tinyBrainAcceptedEventXml: Events._buildTinyBrainAcceptedEventXml(eventSequence),
            currentLocation: {
                name: `${sectionKind} location`,
                description: `${sectionKind.toUpperCase()}_BASE_CONTEXT_SENTINEL`,
            },
            tinyBrainEventStages: [{
                id: 'items',
                label: 'currency',
                instructions: 'Report currency changes.',
                allowedTags: ['currency'],
                requiredTags: [],
                allowedTagList: '<currency>',
                allowRegisteredXmlEvents: false
            }]
        });
        const tinyBrain = configureTinyBrainPromptContext(templateContext, 'event_checks');
        const rendered = env.render('base-context.xml.njk', templateContext);
        return Events._runTinyBrainEventXmlPrompt({
            initialRenderedTemplate: rendered,
            templateContext,
            tinyBrain,
            promptEnv: env,
            parseXMLTemplate,
            tinyBrainEventSequence: eventSequence
        });
    };

    Globals.config = { ai: { retryAttempts: 0 } };
    LLMClient.chatCompletion = async (options = {}) => {
        completionMessages.push(options.messages.map(message => ({ ...message })));
        const policy = LLMClient.applyBaseContextToolPolicy(options.messages, {
            metadataLabel: 'event_checks',
            additionalPayload: {},
            preserveCallerToolDefinitions: true
        });
        providerMessages.push(
            LLMClient.expandPromptMessageBoundaries(policy.messages)
                .map(message => ({ ...message }))
        );
        return scriptedResponses[responseIndex++];
    };
    LLMClient.logPrompt = (options = {}) => {
        logCalls.push(options);
        return options.filePath || logFilePath;
    };

    try {
        const origin = await runSection('origin');
        const destination = await runSection('destination');
        const tracker = await runSection('tracker');

        assert.match(origin, /<currency>/);
        assert.doesNotMatch(destination, /<currency>/);
        assert.doesNotMatch(tracker, /<currency>/);
        assert.equal(completionMessages.length, 3);
        assert.ok(completionMessages[1].some(message => (
            message.role === 'assistant'
            && message.content === scriptedResponses[0]
        )));
        assert.match(completionMessages[1].at(-1).content, /<acceptedSectionEvents>/);
        assert.match(completionMessages[1].at(-1).content, /<currency><amount>5<\/amount><\/currency>/);
        const baseContextEndMarker = LLMClient.getBaseContextEndMarker();
        const rawSecondTranscript = completionMessages[1]
            .map(message => message.content || '')
            .join('\n');
        const rawThirdTranscript = completionMessages[2]
            .map(message => message.content || '')
            .join('\n');
        assert.equal(rawSecondTranscript.split(baseContextEndMarker).length - 1, 1);
        assert.equal(rawThirdTranscript.split(baseContextEndMarker).length - 1, 1);
        assert.match(rawSecondTranscript, /DESTINATION_BASE_CONTEXT_SENTINEL/);
        assert.doesNotMatch(rawSecondTranscript, /ORIGIN_BASE_CONTEXT_SENTINEL/);
        assert.match(rawThirdTranscript, /TRACKER_BASE_CONTEXT_SENTINEL/);
        assert.doesNotMatch(
            rawThirdTranscript,
            /ORIGIN_BASE_CONTEXT_SENTINEL|DESTINATION_BASE_CONTEXT_SENTINEL/
        );
        assert.equal(providerMessages.length, 3);
        assert.ok(providerMessages[1].some(message => (
            message.role === 'assistant'
            && message.content === scriptedResponses[0]
        )));
        assert.ok(providerMessages[1].every(message => (
            typeof message.content !== 'string'
            || !message.content.includes(LLMClient.getBaseContextEndMarker())
        )));
        assert.ok(providerMessages[1].every(message => (
            typeof message.content !== 'string'
            || !message.content.includes(LLMClient.getBaseContextSectionMessageBoundaryMarker())
        )));
        const providerThirdTranscript = providerMessages[2]
            .map(message => message.content || '')
            .join('\n');
        assert.match(providerThirdTranscript, /TRACKER_BASE_CONTEXT_SENTINEL/);
        assert.doesNotMatch(
            providerThirdTranscript,
            /ORIGIN_BASE_CONTEXT_SENTINEL|DESTINATION_BASE_CONTEXT_SENTINEL/
        );
        assert.equal(eventSequence.continuationState.logFilePath, logFilePath);
        assert.equal(logCalls.filter(call => !call.append).length, 1);
        assert.ok(logCalls.slice(1).every(call => call.filePath === logFilePath));
    } finally {
        Globals.config = previousConfig;
        LLMClient.chatCompletion = previousChatCompletion;
        LLMClient.logPrompt = previousLogPrompt;
    }
});

test('runEventChecks uses category stages and applies accepted events when tinybrain is enabled', async () => {
    const previousConfig = Globals.config;
    const previousCurrentPlayer = Globals.currentPlayer;
    const previousChatCompletion = LLMClient.chatCompletion;
    const previousLogPrompt = LLMClient.logPrompt;
    const previousDeps = Events._deps;
    const previousTimeout = Events._baseTimeout;
    const previousParsers = Events._parsers;
    const previousAggregators = Events._aggregators;
    const previousHandlers = Events._handlers;

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

    const script = [
        '<done/>',
        '<events><currency><amount>7</amount></currency></events>',
        '<done/>',
        '<done/>',
        '<done/>',
        '<events><inCombat><value>false</value></inCombat><anyQuestObjectivesCompleted><value>false</value></anyQuestObjectivesCompleted></events>',
        '<done/>'
    ];
    let eventStageCalls = 0;
    const loggedPrefixes = [];

    try {
        Globals.config = {
            ai: { tinybrain: true, retryAttempts: 1 },
            event_checks: { enabled: true },
            quests: { enabled: false },
            omit_npc_generation: true
        };
        Globals.currentPlayer = player;
        LLMClient.chatCompletion = async (options = {}) => {
            const lastMessage = Array.isArray(options.messages)
                ? options.messages[options.messages.length - 1]?.content || ''
                : '';
            if (lastMessage.includes('affectedNeedBars')) {
                return '<characters></characters>';
            }
            const response = script[Math.min(eventStageCalls, script.length - 1)];
            eventStageCalls += 1;
            return response;
        };
        LLMClient.logPrompt = (entry) => {
            loggedPrefixes.push(entry?.prefix || null);
            return '/tmp/tinybrain-events-runeventchecks.log';
        };

        Events.initialize({
            promptEnv: createEventsPromptEnv(),
            parseXMLTemplate,
            prepareBasePromptContext: async () => ({
                ...buildBaseRenderContext({}),
                needBarDefinitions: [],
                npcs: [],
                party: [],
                currentLocation: { name: 'Test Location' },
                regionContext: { name: 'Test Region' },
                characterName: 'Wanderer',
                experiencePointValues: [],
                config: Globals.config
            }),
            Location: { get: () => null },
            findRegionByLocationId: () => null,
            findActorByName: (name) => (name === 'Wanderer' ? player : null),
            getCurrentPlayer: () => player,
            getConfig: () => Globals.config
        });

        const result = await Events.runEventChecks({
            textToCheck: 'Wanderer finds seven coins.'
        });

        assert.equal(eventStageCalls, 7);
        assert.equal(result.currencyChanges.length, 1);
        assert.equal(result.currencyChanges[0].amount, 7);
        assert.equal(player.currency, 7);
        assert.ok(
            loggedPrefixes.includes('events_tinybrain'),
            `expected events_tinybrain log prefix, got: ${loggedPrefixes.join(', ')}`
        );
    } finally {
        Events._deps = previousDeps;
        Events._baseTimeout = previousTimeout;
        Events._parsers = previousParsers;
        Events._aggregators = previousAggregators;
        Events._handlers = previousHandlers;
        Globals.config = previousConfig;
        Globals.currentPlayer = previousCurrentPlayer;
        LLMClient.chatCompletion = previousChatCompletion;
        LLMClient.logPrompt = previousLogPrompt;
    }
});

test('tiny-brain event stage retry exhaustion fails explicitly without assembling invalid XML', async () => {
    const previousConfig = Globals.config;
    const previousChatCompletion = LLMClient.chatCompletion;
    const previousLogPrompt = LLMClient.logPrompt;
    const previousWithPromptProgressGroup = LLMClient.withPromptProgressGroup;
    const previousClearPromptProgressGroup = LLMClient.clearPromptProgressGroup;
    const env = createEventsPromptEnv();
    const templateContext = buildEventsContext();
    const tinyBrain = configureTinyBrainPromptContext(templateContext, 'event_checks');
    const rendered = env.render('base-context.xml.njk', templateContext);
    let calls = 0;

    try {
        Globals.config = { ai: { retryAttempts: 1 } };
        LLMClient.chatCompletion = async () => {
            calls += 1;
            return '<events><currency><amount>3</amount></currency></events>';
        };
        LLMClient.logPrompt = () => '/tmp/tinybrain-events-exhaustion.log';
        LLMClient.withPromptProgressGroup = async (_options, callback) => await callback();
        LLMClient.clearPromptProgressGroup = () => {};

        await assert.rejects(
            Events._runTinyBrainEventXmlPrompt({
                initialRenderedTemplate: rendered,
                templateContext,
                tinyBrain,
                promptEnv: env,
                parseXMLTemplate
            }),
            /checkpoint 1 failed to parse after 2 attempts.*does not allow <currency>/s
        );
        assert.equal(calls, 2);
        assert.equal(Object.keys(tinyBrain.renderState.completedCheckpoints).length, 0);
    } finally {
        Globals.config = previousConfig;
        LLMClient.chatCompletion = previousChatCompletion;
        LLMClient.logPrompt = previousLogPrompt;
        LLMClient.withPromptProgressGroup = previousWithPromptProgressGroup;
        LLMClient.clearPromptProgressGroup = previousClearPromptProgressGroup;
    }
});
